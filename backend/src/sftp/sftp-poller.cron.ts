import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EdiParserService, ParsedEdiReport, ReportSummary } from '../edi/edi-parser.service';
import { InboundFile, SftpService } from './sftp.service';

/**
 * @nestjs/schedule 4.1.2 exposes EVERY_10_MINUTES and EVERY_30_MINUTES, not EVERY_15_MINUTES.
 * This uses the same 6-field form: at second 0, every 15 minutes.
 */
export const EVERY_15_MINUTES = '0 */15 * * * *';

export interface InboundPollItem {
  fileName: string;
  modifiedAt: string;
  parsed: ParsedEdiReport;
  summary: ReportSummary;
}

@Injectable()
export class SftpPollerCron {
  private readonly logger = new Logger(SftpPollerCron.name);
  private readonly seen = new Set<string>();
  private readonly reports = new Map<string, InboundPollItem>();
  private running = false;

  constructor(
    private readonly sftpService: SftpService,
    private readonly ediParser: EdiParserService,
  ) {}

  getReports(): InboundPollItem[] {
    return [...this.reports.values()].sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  }

  @Cron(EVERY_15_MINUTES)
  async pollReceiveFiles(): Promise<InboundPollItem[]> {
    if (this.running) {
      this.logger.warn(JSON.stringify({ event: 'receive-files-poll-skipped', reason: 'previous poll still running' }));
      return [];
    }

    this.running = true;
    const parsed: InboundPollItem[] = [];
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;

    try {
      let files: InboundFile[] = [];
      try {
        files = await this.sftpService.downloadReceiveFiles();
        downloaded = files.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown SFTP error';
        this.logger.error(JSON.stringify({ event: 'receive-files-poll-failed', message }));
        throw error;
      }

      for (const file of files) {
        const key = `${file.fileName}|${file.byteSize}|${file.modifiedAt}`;
        if (this.seen.has(key)) {
          skipped += 1;
          continue;
        }

        try {
          const report = this.ediParser.parse(file.content, file.fileName);
          const summary = this.ediParser.summarize(report);
          this.logger.log(JSON.stringify({ event: 'receive-file-parsed', fileName: file.fileName, ...summary }));
          const item: InboundPollItem = {
            fileName: file.fileName,
            modifiedAt: file.modifiedAt,
            parsed: report,
            summary,
          };
          this.reports.set(file.fileName, item);
          parsed.push(item);
          this.seen.add(key);
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : 'Unknown parse error';
          this.logger.error(JSON.stringify({ event: 'receive-file-failed', fileName: file.fileName, message }));
        }
      }

      this.logger.log(
        JSON.stringify({
          event: 'receive-files-poll-complete',
          downloaded,
          parsed: parsed.length,
          skipped,
          failed,
        }),
      );
      return parsed;
    } finally {
      this.running = false;
    }
  }
}
