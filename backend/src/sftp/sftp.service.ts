import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
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

@Injectable()
export class SftpService {
  private readonly logger = new Logger(SftpService.name);

  constructor(private readonly configService: ConfigService) {}

  async uploadBatchFile(fileName: string, content: string | Buffer): Promise<BatchUploadResult> {
    const safeName = this.safeFileName(fileName);
    const payload = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
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
      throw this.toHttpException(error, `SFTP upload failed for ${safeName}`);
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
          errorDetails: this.parseFailureReason(this.readDownloaded(downloaded)),
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
      throw this.toHttpException(error, `SFTP notification check failed for ${safeName}`);
    } finally {
      await this.close(sftp);
    }
  }

  private async connect(): Promise<SftpClient> {
    const host = this.configService.get<string>('AVAILITY_SFTP_HOST') || 'qa-files.availity.com';
    const port = Number(this.configService.get<number | string>('AVAILITY_SFTP_PORT') || 22);
    const username = this.configService.get<string>('AVAILITY_SFTP_USERNAME') || '';
    const password = this.configService.get<string>('AVAILITY_SFTP_PASSWORD') || '';
    const privateKeyPath = this.configService.get<string>('AVAILITY_SFTP_PRIVATE_KEY_PATH') || '';

    if (!username) {
      throw new BadRequestException('AVAILITY_SFTP_USERNAME is required');
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
      throw this.toHttpException(error, `Unable to connect to Availity SFTP ${host}:${port}`);
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
        this.logger.warn(`Receive directory ${receiveDir} does not exist`);
        return [];
      }

      const entries = await sftp.list(receiveDir);
      const downloaded: InboundFile[] = [];
      for (const entry of entries) {
        if (entry.type !== '-') {
          continue;
        }
        try {
          const payload = await sftp.get(`${receiveDir}/${entry.name}`);
          downloaded.push({
            fileName: entry.name,
            byteSize: entry.size,
            modifiedAt: new Date(entry.modifyTime).toISOString(),
            content: this.readDownloaded(payload),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown download error';
          this.logger.error(`Failed to download ${receiveDir}/${entry.name}: ${message}`);
        }
      }
      return downloaded;
    } catch (error) {
      throw this.toHttpException(error, `SFTP download failed for ${receiveDir}`);
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

    return bases.some((base) => suffixes.some((suffix) => remote === `${base}${suffix}`));
  }

  private readDownloaded(payload: string | Buffer | NodeJS.WritableStream): string {
    if (Buffer.isBuffer(payload)) {
      return payload.toString('utf8');
    }
    if (typeof payload === 'string') {
      return payload;
    }
    return '';
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

  private toHttpException(error: unknown, fallback: string): HttpException {
    if (error instanceof HttpException) {
      return error;
    }
    const message = error instanceof Error ? error.message : fallback;
    this.logger.error(message);
    return new HttpException(
      {
        statusCode: HttpStatus.BAD_GATEWAY,
        message: message || fallback,
        error: 'SFTP error',
      },
      HttpStatus.BAD_GATEWAY,
    );
  }
}
