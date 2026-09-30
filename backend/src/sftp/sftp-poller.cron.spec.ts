import { Logger } from '@nestjs/common';
import { EdiParserService } from '../edi/edi-parser.service';
import { InboundFile, SftpService } from './sftp.service';
import { SftpPollerCron } from './sftp-poller.cron';

describe('SftpPollerCron', () => {
  const downloadReceiveFiles = jest.fn<Promise<InboundFile[]>, []>();

  function cron(): SftpPollerCron {
    return new SftpPollerCron({ downloadReceiveFiles } as unknown as SftpService, new EdiParserService());
  }

  beforeEach(() => {
    downloadReceiveFiles.mockReset();
  });

  it('parses new /ReceiveFiles content and logs a JSON summary', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    downloadReceiveFiles.mockResolvedValue([
      {
        fileName: 'batch.ibr',
        byteSize: 20,
        modifiedAt: '2026-09-28T14:32:00.000Z',
        content: '1|2026-09-28|BAT-1|FCN-1|1|0|1\n3|DOE, JOHN|20260920|PCN-1|R\n',
      },
      {
        fileName: 'notes.txt',
        byteSize: 4,
        modifiedAt: '2026-09-28T14:32:00.000Z',
        content: 'hello',
      },
    ]);

    const worker = cron();
    const results = await worker.pollReceiveFiles();

    expect(results).toHaveLength(2);
    expect(worker.getReports().map((item) => item.fileName)).toEqual(['batch.ibr', 'notes.txt']);
    expect(results[0].summary).toMatchObject({
      reportType: 'IBR',
      batchId: 'BAT-1',
      totalRejected: 1,
    });
    expect(results[1].summary.reportType).toBe('UNKNOWN');
    const summaries = log.mock.calls.map((call) => String(call[0]));
    expect(summaries.some((line) => line.includes('"event":"receive-file-parsed"') && line.includes('"fileName":"batch.ibr"'))).toBe(
      true,
    );
    expect(summaries.some((line) => line.includes('"event":"receive-files-poll-complete"') && line.includes('"parsed":2'))).toBe(
      true,
    );
    log.mockRestore();
  });

  it('skips a file that was already parsed', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const file: InboundFile = {
      fileName: 'batch.ebr',
      byteSize: 8,
      modifiedAt: '2026-09-28T14:32:00.000Z',
      content: '1|2026-09-28|BAT-2|FCN-2|0|0|0\n',
    };
    downloadReceiveFiles.mockResolvedValue([file]);
    const worker = cron();

    await worker.pollReceiveFiles();
    const second = await worker.pollReceiveFiles();

    expect(second).toEqual([]);
    expect(downloadReceiveFiles).toHaveBeenCalledTimes(2);
    jest.restoreAllMocks();
  });

  it('does not start a second poll while the first download is open', async () => {
    let release: (files: InboundFile[]) => void = () => undefined;
    downloadReceiveFiles.mockImplementation(
      () =>
        new Promise<InboundFile[]>((resolve) => {
          release = resolve;
        }),
    );
    const worker = cron();
    const first = worker.pollReceiveFiles();
    await Promise.resolve();
    await expect(worker.pollReceiveFiles()).resolves.toEqual([]);
    release([]);
    await expect(first).resolves.toEqual([]);
  });

  it('surfaces an SFTP download failure instead of an empty report list', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    downloadReceiveFiles.mockRejectedValue(new Error('AVAILITY_SFTP_USERNAME is required'));
    await expect(cron().pollReceiveFiles()).rejects.toThrow('AVAILITY_SFTP_USERNAME is required');
    jest.restoreAllMocks();
  });
});
