import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import SftpClient = require('ssh2-sftp-client');

const MAX_BATCH_BYTES = 150 * 1024 * 1024;
const SUCCESS_SUFFIXES = ['-success', '_-success', '_success'];
const FAILED_SUFFIXES = ['-failed', '_-failed', '_failed'];

export interface BatchUploadResult {
  fileName: string;
  remotePath: string;
  byteSize: number;
  uploadedAt: string;
  status: 'UPLOADED';
}

export interface UploadNotificationStatus {
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  errorDetails?: string;
  fileName: string;
  notificationFile?: string;
}

export interface InboundFile {
  fileName: string;
  byteSize: number;
  modifiedAt: string;
  content: string;
}

export interface RemoteFileEntry {
  fileName: string;
  byteSize: number;
  modifiedAt: string;
  type: string;
}

export class SftpOperationError extends Error {
  readonly op: string;
  readonly upstream: string;
  readonly statusCode = 502;

  constructor(op: string, err: unknown) {
    const upstream = err instanceof Error && err.message ? err.message : 'SFTP operation failed';
    super(upstream);
    this.name = 'SftpOperationError';
    this.op = op;
    this.upstream = upstream;
  }
}

@Injectable()
export class SftpService {
  private readonly logger = new Logger(SftpService.name);

  constructor(private readonly configService: ConfigService) {}

  async uploadBatchFile(fileName: string, content: string | Buffer): Promise<BatchUploadResult> {
    const safeName = this.safeFileName(fileName);
    const text = Buffer.isBuffer(content) ? content.toString('utf8') : content;
    this.assertIsaFixedFields(text);
    const payload = Buffer.from(text, 'utf8');
    if (payload.length === 0) {
      throw new BadRequestException('Cannot upload an empty batch file');
    }
    if (payload.length > MAX_BATCH_BYTES) {
      throw new BadRequestException(
        `Batch file exceeds the 150 MB Availity limit (${(payload.length / (1024 * 1024)).toFixed(2)} MB)`,
      );
    }

    const sendDir = this.sendDirectory();
    const remotePath = `${sendDir}/${safeName}`;
    const sftp = await this.connect();
    try {
      const directory = await sftp.exists(sendDir);
      if (!directory) {
        await sftp.mkdir(sendDir, true);
      }
      this.logger.log(`Uploading ${safeName} (${payload.length} bytes) to ${remotePath}`);
      await sftp.put(payload, remotePath);
      return {
        fileName: safeName,
        remotePath,
        byteSize: payload.length,
        uploadedAt: new Date().toISOString(),
        status: 'UPLOADED',
      };
    } catch (error) {
      this.rethrow('uploadBatchFile', error);
    } finally {
      await this.close(sftp);
    }
  }

  async checkUploadNotification(fileName: string): Promise<UploadNotificationStatus> {
    const safeName = this.safeFileName(fileName);
    const sendDir = this.sendDirectory();
    const sftp = await this.connect();
    try {
      const files = await sftp.list(sendDir);
      const failed = files.find((file) => this.matchesNotification(file.name, safeName, FAILED_SUFFIXES));
      if (failed) {
        const downloaded = await sftp.get(`${sendDir}/${failed.name}`);
        return {
          status: 'FAILED',
          fileName: safeName,
          notificationFile: failed.name,
          errorDetails: this.parseFailureReason(this.readDownloaded(downloaded, `${sendDir}/${failed.name}`)),
        };
      }

      const success = files.find((file) => this.matchesNotification(file.name, safeName, SUCCESS_SUFFIXES));
      if (success) {
        return {
          status: 'SUCCESS',
          fileName: safeName,
          notificationFile: success.name,
        };
      }

      return {
        status: 'PENDING',
        fileName: safeName,
      };
    } catch (error) {
      this.rethrow('checkUploadNotification', error);
    } finally {
      await this.close(sftp);
    }
  }

  private async connect(): Promise<SftpClient> {
    const host = this.requiredSetting('AVAILITY_SFTP_HOST');
    const port = Number(this.configService.get<number | string>('AVAILITY_SFTP_PORT'));
    const username = this.requiredSetting('AVAILITY_SFTP_USERNAME');
    const password = this.configService.get<string>('AVAILITY_SFTP_PASSWORD')?.trim() ?? '';
    const privateKeyPath = this.configService.get<string>('AVAILITY_SFTP_PRIVATE_KEY_PATH')?.trim() ?? '';

    if (!Number.isInteger(port) || port <= 0) {
      throw new SftpOperationError('connect', new Error('AVAILITY_SFTP_PORT is required'));
    }

    if (privateKeyPath && password) {
      throw new BadRequestException('Use either AVAILITY_SFTP_PASSWORD or AVAILITY_SFTP_PRIVATE_KEY_PATH, not both');
    }

    if (password) {
      this.assertPasswordPolicy(username, password);
    }

    const options: SftpClient.ConnectOptions = {
      host,
      port,
      username,
      readyTimeout: 20000,
    };

    if (privateKeyPath) {
      if (!fs.existsSync(privateKeyPath)) {
        throw new BadRequestException(`SFTP private key was not found at ${privateKeyPath}`);
      }
      options.privateKey = fs.readFileSync(privateKeyPath);
    } else if (password) {
      options.password = password;
    } else {
      throw new BadRequestException('Set AVAILITY_SFTP_PASSWORD or AVAILITY_SFTP_PRIVATE_KEY_PATH before connecting');
    }

    const sftp = new SftpClient();
    try {
      this.logger.log(`Connecting to Availity SFTP ${host}:${port}`);
      await sftp.connect(options);
      return sftp;
    } catch (error) {
      await this.close(sftp);
      this.rethrow('connect', error);
    }
  }

  private async close(sftp: SftpClient): Promise<void> {
    try {
      await sftp.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown close error';
      this.logger.warn(`SFTP connection close failed: ${message}`);
    }
  }

  async downloadReceiveFiles(): Promise<InboundFile[]> {
    const receiveDir = this.receiveDirectory();
    const sftp = await this.connect();
    try {
      const directory = await sftp.exists(receiveDir);
      if (!directory) {
        throw new SftpOperationError('downloadReceiveFiles', new Error(`Receive directory ${receiveDir} does not exist`));
      }

      const entries = await sftp.list(receiveDir);
      const downloaded: InboundFile[] = [];
      for (const entry of entries) {
        if (entry.type !== '-') {
          continue;
        }
        const payload = await sftp.get(`${receiveDir}/${entry.name}`);
        downloaded.push({
          fileName: entry.name,
          byteSize: entry.size,
          modifiedAt: new Date(entry.modifyTime).toISOString(),
          content: this.readDownloaded(payload, `${receiveDir}/${entry.name}`),
        });
      }
      return downloaded;
    } catch (error) {
      this.rethrow('downloadReceiveFiles', error);
    } finally {
      await this.close(sftp);
    }
  }

  async listSendFiles(): Promise<RemoteFileEntry[]> {
    return this.listDirectory(this.sendDirectory(), 'listSendFiles');
  }

  async listReceiveFiles(): Promise<RemoteFileEntry[]> {
    return this.listDirectory(this.receiveDirectory(), 'listReceiveFiles');
  }

  private async listDirectory(dir: string, op: string): Promise<RemoteFileEntry[]> {
    const sftp = await this.connect();
    try {
      const entries = await sftp.list(dir);
      return entries.map((entry) => ({
        fileName: entry.name,
        byteSize: entry.size,
        modifiedAt: new Date(entry.modifyTime).toISOString(),
        type: entry.type,
      }));
    } catch (error) {
      this.rethrow(op, error);
    } finally {
      await this.close(sftp);
    }
  }

  private sendDirectory(): string {
    return this.normalizeDirectory(this.configService.get<string>('AVAILITY_SFTP_SEND_PATH'), '/SendFiles');
  }

  private receiveDirectory(): string {
    return this.normalizeDirectory(this.configService.get<string>('AVAILITY_SFTP_RECEIVE_PATH'), '/ReceiveFiles');
  }

  private normalizeDirectory(configured: string | undefined, fallback: string): string {
    const normalized = (configured || fallback).replace(/\/+$/, '');
    return normalized || fallback;
  }

  // Companion Guide §3.1. History, expiry, and lockout are account rules Availity enforces; this checks only the composition we can see.
  private assertPasswordPolicy(username: string, password: string): void {
    const problems: string[] = [];
    if (password.length < 14) {
      problems.push('at least 14 characters');
    }
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      problems.push('one lowercase, one uppercase, one number, and one special character');
    }
    if (username && password.toLowerCase().includes(username.toLowerCase())) {
      problems.push('must not contain the SFTP username');
    }
    if (problems.length > 0) {
      throw new BadRequestException(`SFTP password does not meet Availity policy: ${problems.join('; ')}`);
    }
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private safeFileName(fileName: string): string {
    const trimmed = fileName?.trim() ?? '';
    const base = path.basename(trimmed);
    if (!trimmed || base !== trimmed || base === '.' || base === '..' || base.includes('\0')) {
      throw new BadRequestException('Batch file name must be a single file name without a directory');
    }
    return base;
  }

  private matchesNotification(remoteName: string, uploadedName: string, suffixes: string[]): boolean {
    const remote = remoteName.toLowerCase();
    const extension = path.extname(uploadedName);
    const bases = [uploadedName, extension ? uploadedName.slice(0, -extension.length) : uploadedName]
      .map((name) => name.toLowerCase())
      .filter((name, index, all) => name.length > 0 && all.indexOf(name) === index);

    return bases.some((base) =>
      suffixes.some((suffix) => {
        if (remote === `${base}${suffix}`) {
          return true;
        }
        // Companion Guide §3.4: <original>-<AvailityBatchID>-success or -FAILED. Batch ID shape is UNCONFIRMED beyond digits.
        if (suffix === '-success' || suffix === '-failed') {
          return new RegExp(`^${this.escapeRegex(base)}-\\d{8,}${suffix}$`, 'i').test(remote);
        }
        return false;
      }),
    );
  }

  private readDownloaded(payload: string | Buffer | NodeJS.WritableStream, remotePath: string): string {
    if (Buffer.isBuffer(payload)) {
      return payload.toString('utf8');
    }
    if (typeof payload === 'string') {
      return payload;
    }
    throw new SftpOperationError('download', new Error(`SFTP get for ${remotePath} did not return file bytes`));
  }

  private assertIsaFixedFields(content: string): void {
    if (!content.startsWith('ISA')) {
      return;
    }
    if (content.includes('\r') || content.includes('\n')) {
      throw new BadRequestException('X12 batch must not contain line breaks; they shift ISA fixed fields');
    }
    const isa = content.split('~', 1)[0] ?? '';
    const elements = isa.split('*');
    if (elements.length < 9 || elements[0] !== 'ISA') {
      return;
    }
    if (elements[5] !== 'ZZ') {
      throw new BadRequestException('ISA05 Interchange ID Qualifier must be ZZ');
    }
    if (elements[6].length !== 15) {
      throw new BadRequestException(
        `ISA06 Interchange Sender ID must be 15 characters before upload, received ${elements[6].length}`,
      );
    }
  }

  private requiredSetting(key: string): string {
    const value = this.configService.get<string>(key)?.trim();
    if (!value) {
      throw new SftpOperationError('connect', new Error(`${key} is required`));
    }
    return value;
  }

  private rethrow(op: string, error: unknown): never {
    if (error instanceof BadRequestException || error instanceof SftpOperationError) {
      throw error;
    }
    throw new SftpOperationError(op, error);
  }

  private parseFailureReason(raw: string): string {
    const text = raw.replace(/^\uFEFF/, '').trim();
    if (!text) {
      return 'Availity rejected the file without an error message';
    }

    const labeled = text.match(/(?:error|reason|message)\s*[:=-]\s*(.+)/i);
    if (labeled?.[1]) {
      const reason = labeled[1].split(/\r?\n/)[0]?.trim();
      if (reason) {
        return reason.slice(0, 2000);
      }
    }

    const line = text
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find((entry) => entry.length > 0);
    return (line || text).slice(0, 2000);
  }
}
