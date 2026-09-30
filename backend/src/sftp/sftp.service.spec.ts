import { BadRequestException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SftpService } from './sftp.service';

const mockSftp = {
  connect: jest.fn(),
  put: jest.fn(),
  exists: jest.fn(),
  mkdir: jest.fn(),
  list: jest.fn(),
  get: jest.fn(),
  end: jest.fn(),
};

jest.mock('ssh2-sftp-client', () => {
  return jest.fn().mockImplementation(() => mockSftp);
});

function service(): SftpService {
  const values: Record<string, string> = {
    AVAILITY_SFTP_HOST: 'qa-files.availity.com',
    AVAILITY_SFTP_PORT: '22',
    AVAILITY_SFTP_USERNAME: 'qa-user',
    AVAILITY_SFTP_PASSWORD: 'Qa-Test-123456',
    AVAILITY_SFTP_SEND_PATH: '/SendFiles',
  };
  return new SftpService({
    get: (key: string) => values[key],
  } as ConfigService);
}

describe('SftpService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSftp.connect.mockResolvedValue(undefined);
    mockSftp.put.mockResolvedValue('ok');
    mockSftp.exists.mockResolvedValue('d');
    mockSftp.mkdir.mockResolvedValue('ok');
    mockSftp.list.mockResolvedValue([]);
    mockSftp.get.mockResolvedValue(Buffer.from(''));
    mockSftp.end.mockResolvedValue(true);
  });

  it('uploads an X12 payload to /SendFiles and closes the connection', async () => {
    const result = await service().uploadBatchFile('BATCH_000000001.txt', 'ISA*00*~');

    expect(mockSftp.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'qa-files.availity.com',
        port: 22,
        username: 'qa-user',
        password: 'Qa-Test-123456',
      }),
    );
    expect(mockSftp.put).toHaveBeenCalledWith(expect.any(Buffer), '/SendFiles/BATCH_000000001.txt');
    expect(result).toMatchObject({
      fileName: 'BATCH_000000001.txt',
      remotePath: '/SendFiles/BATCH_000000001.txt',
      status: 'UPLOADED',
      byteSize: Buffer.byteLength('ISA*00*~'),
    });
    expect(mockSftp.end).toHaveBeenCalledTimes(1);
  });

  it('closes the connection when the upload fails', async () => {
    mockSftp.put.mockRejectedValue(new Error('disk full'));

    await expect(service().uploadBatchFile('BATCH_000000001.txt', 'ISA*00*~')).rejects.toBeInstanceOf(HttpException);
    expect(mockSftp.end).toHaveBeenCalledTimes(1);
  });

  it('closes the socket when authentication fails', async () => {
    mockSftp.connect.mockRejectedValue(new Error('All configured authentication methods failed'));

    await expect(service().uploadBatchFile('BATCH_000000001.txt', 'ISA*00*~')).rejects.toBeInstanceOf(HttpException);
    expect(mockSftp.end).toHaveBeenCalledTimes(1);
    expect(mockSftp.put).not.toHaveBeenCalled();
  });

  it('returns SUCCESS for a -success notification', async () => {
    mockSftp.list.mockResolvedValue([{ name: 'BATCH_000000001.txt-success', type: '-' }]);

    await expect(service().checkUploadNotification('BATCH_000000001.txt')).resolves.toEqual({
      status: 'SUCCESS',
      fileName: 'BATCH_000000001.txt',
      notificationFile: 'BATCH_000000001.txt-success',
    });
    expect(mockSftp.end).toHaveBeenCalledTimes(1);
  });

  it('returns SUCCESS for a _-success notification', async () => {
    mockSftp.list.mockResolvedValue([{ name: 'BATCH_000000001.txt_-success', type: '-' }]);

    await expect(service().checkUploadNotification('BATCH_000000001.txt')).resolves.toMatchObject({
      status: 'SUCCESS',
      notificationFile: 'BATCH_000000001.txt_-success',
    });
  });

  it('downloads a _-FAILED file and returns the error reason', async () => {
    mockSftp.list.mockResolvedValue([{ name: 'BATCH_000000001.txt_-FAILED', type: '-' }]);
    mockSftp.get.mockResolvedValue(Buffer.from('Error: Invalid ISA header\n'));

    await expect(service().checkUploadNotification('BATCH_000000001.txt')).resolves.toEqual({
      status: 'FAILED',
      fileName: 'BATCH_000000001.txt',
      notificationFile: 'BATCH_000000001.txt_-FAILED',
      errorDetails: 'Invalid ISA header',
    });
    expect(mockSftp.get).toHaveBeenCalledWith('/SendFiles/BATCH_000000001.txt_-FAILED');
    expect(mockSftp.end).toHaveBeenCalledTimes(1);
  });

  it('returns the plain failure text when Availity does not label the reason', async () => {
    mockSftp.list.mockResolvedValue([{ name: 'BATCH_000000001.txt-FAILED', type: '-' }]);
    mockSftp.get.mockResolvedValue(Buffer.from('Empty file'));

    await expect(service().checkUploadNotification('BATCH_000000001.txt')).resolves.toMatchObject({
      status: 'FAILED',
      errorDetails: 'Empty file',
    });
  });

  it('returns SUCCESS when the notification includes an Availity batch id', async () => {
    mockSftp.list.mockResolvedValue([{ name: 'BATCH_000000001.txt-2026092814300001-success', type: '-' }]);

    await expect(service().checkUploadNotification('BATCH_000000001.txt')).resolves.toMatchObject({
      status: 'SUCCESS',
      notificationFile: 'BATCH_000000001.txt-2026092814300001-success',
    });
  });

  it('returns PENDING when no notification file is present', async () => {
    mockSftp.list.mockResolvedValue([{ name: 'BATCH_000000001.txt', type: '-' }]);

    await expect(service().checkUploadNotification('BATCH_000000001.txt')).resolves.toEqual({
      status: 'PENDING',
      fileName: 'BATCH_000000001.txt',
    });
  });

  it('downloads regular files from /ReceiveFiles and continues after one failure', async () => {
    mockSftp.list.mockResolvedValue([
      { name: 'batch.ibr', type: '-', size: 12, modifyTime: 1_700_000_000_000 },
      { name: 'ack.999', type: '-', size: 4, modifyTime: 1_700_000_000_000 },
      { name: 'archive', type: 'd', size: 0, modifyTime: 1_700_000_000_000 },
    ]);
    mockSftp.get.mockResolvedValueOnce(Buffer.from('1|2026-09-28|BAT|FCN|1|1|0')).mockRejectedValueOnce(new Error('read failed'));

    const files = await service().downloadReceiveFiles();

    expect(mockSftp.list).toHaveBeenCalledWith('/ReceiveFiles');
    expect(files).toEqual([
      expect.objectContaining({
        fileName: 'batch.ibr',
        content: '1|2026-09-28|BAT|FCN|1|1|0',
      }),
    ]);
    expect(mockSftp.end).toHaveBeenCalledTimes(1);
  });

  it('rejects a path-like file name before opening a connection', async () => {
    await expect(service().uploadBatchFile('../BATCH.txt', 'ISA*00*~')).rejects.toBeInstanceOf(BadRequestException);
    expect(mockSftp.connect).not.toHaveBeenCalled();
  });
});
