import './e2e-env';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AxiosError } from 'axios';
import { AppModule } from '../src/app.module';
import { AvailityRestService } from '../src/availity-rest/availity-rest.service';
import {
  SAMPLE_BATCH_ID,
  SAMPLE_CLAIM_CONTROL_NUMBER,
  SAMPLE_FILE_CONTROL_NUMBER,
  claimStatusQuery,
  eligibilityInquiry,
  professionalClaim,
  sample999,
  sampleEbr,
  sampleIbr,
} from '../src/common/mock-data.seed';
import { AvailityController } from '../src/controllers/availity.controller';
import { Acknowledgment999, EdiParserService, PipeDelimitedReport } from '../src/edi/edi-parser.service';
import { SftpPollerCron } from '../src/sftp/sftp-poller.cron';

const mockHttp = {
  interceptors: {
    response: {
      use: jest.fn(),
    },
  },
  get: jest.fn(),
  post: jest.fn(),
  request: jest.fn(),
};

const mockSftp = {
  connect: jest.fn(),
  put: jest.fn(),
  exists: jest.fn(),
  mkdir: jest.fn(),
  list: jest.fn(),
  get: jest.fn(),
  end: jest.fn(),
};

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  const axiosActual = actual.default ?? actual;
  const tokenPost = jest.fn();
  (globalThis as { __availityTokenPost?: jest.Mock }).__availityTokenPost = tokenPost;
  const mocked = {
    ...axiosActual,
    create: jest.fn(() => (globalThis as { __availityHttp?: typeof mockHttp }).__availityHttp),
    post: tokenPost,
    isAxiosError: (...args: unknown[]) => axiosActual.isAxiosError(...args),
  };
  return { ...actual, __esModule: true, default: mocked, AxiosError: axiosActual.AxiosError };
});

(globalThis as { __availityHttp?: typeof mockHttp }).__availityHttp = mockHttp;

jest.mock('ssh2-sftp-client', () => {
  return jest.fn().mockImplementation(() => mockSftp);
});

const tokenUrl = 'https://api.availity.com/availity/v1/token';
const coverageBody = {
  id: 'COV-44821',
  status: 'Active',
  payerName: 'Aetna Commercial Payer',
  plans: [
    {
      status: 'Active',
      planName: 'Aetna Choice POS II',
      copay: { amount: 30 },
      deductible: { individualRemaining: 450 },
      coinsurance: { percent: 20 },
    },
  ],
};

function logStep(title: string, payload: unknown) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(payload, null, 2));
}

function tokenPost(): jest.Mock {
  const posted = (globalThis as { __availityTokenPost?: jest.Mock }).__availityTokenPost;
  if (!posted) {
    throw new Error('Axios token mock was not installed');
  }
  return posted;
}

let handlePost: (url: string, data: unknown, config: { headers?: Record<string, string>; url?: string; method?: string; data?: unknown }) => Promise<{ data: unknown }> =
  async () => ({ data: coverageBody });
let handleGet: (url: string) => Promise<{ data: unknown }> = async () => ({ data: { id: 'CS-1001', status: 'Finalized' } });

describe('Availity PoC workflows', () => {
  let app: INestApplication;
  let controller: AvailityController;
  let rest: AvailityRestService;
  let parser: EdiParserService;
  let poller: SftpPollerCron;
  let responseError: ((error: unknown) => Promise<unknown>) | undefined;
  let tokenCount = 0;

  beforeAll(async () => {
    mockHttp.interceptors.response.use.mockImplementation((_success: unknown, error: (error: unknown) => Promise<unknown>) => {
      responseError = error;
      return 0;
    });
    mockHttp.post.mockImplementation(async (url: string, data: unknown, config: { headers?: Record<string, string> }) => {
      try {
        return await handlePost(url, data, config);
      } catch (error) {
        if (!responseError) {
          throw error;
        }
        return responseError(error);
      }
    });
    mockHttp.get.mockImplementation(async (url: string) => handleGet(url));
    mockHttp.request.mockImplementation(async (config: { method?: string; url?: string; data?: unknown; headers?: Record<string, string> }) => {
      const method = String(config.method || 'get').toLowerCase();
      if (method === 'post') {
        return handlePost(String(config.url), config.data, config);
      }
      return handleGet(String(config.url));
    });
    tokenPost().mockImplementation(async () => {
      tokenCount += 1;
      return {
        data: {
          access_token: `poc-token-${tokenCount}`,
          token_type: 'Bearer',
          expires_in: 300,
          scope: 'hipaa',
        },
      };
    });
    handlePost = async () => ({ data: coverageBody });
    handleGet = async () => ({ data: { id: 'CS-1001', status: 'Finalized' } });
    mockSftp.connect.mockResolvedValue(undefined);
    mockSftp.put.mockResolvedValue('ok');
    mockSftp.exists.mockResolvedValue('d');
    mockSftp.mkdir.mockResolvedValue('ok');
    mockSftp.list.mockResolvedValue([]);
    mockSftp.get.mockResolvedValue(Buffer.from(''));
    mockSftp.end.mockResolvedValue(true);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    controller = app.get(AvailityController);
    rest = app.get(AvailityRestService);
    parser = app.get(EdiParserService);
    poller = app.get(SftpPollerCron);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('requests an OAuth token and refreshes it on demand and after HTTP 401', async () => {
    const issuedAtStartup = tokenCount;
    expect(issuedAtStartup).toBeGreaterThanOrEqual(1);
    expect(tokenPost()).toHaveBeenCalledWith(
      tokenUrl,
      expect.any(URLSearchParams),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      }),
    );

    const cached = await rest.getAuthToken();
    expect(cached).toBe(`poc-token-${issuedAtStartup}`);
    expect(tokenCount).toBe(issuedAtStartup);

    const refreshed = await rest.getAuthToken(true);
    expect(refreshed).toBe(`poc-token-${issuedAtStartup + 1}`);
    expect(tokenCount).toBe(issuedAtStartup + 1);

    const previousPost = handlePost;
    handlePost = async (_url, _data, config) => {
      handlePost = previousPost;
      const error = new AxiosError('Request failed with status code 401');
      const requestConfig = {
        ...(config ?? {}),
        headers: config?.headers ?? {},
        url: '/availity/v1/coverages',
        method: 'post',
      } as NonNullable<AxiosError['config']>;
      error.config = requestConfig;
      error.response = {
        status: 401,
        statusText: 'Unauthorized',
        data: { error: 'invalid_token', error_description: 'The access token expired' },
        headers: {},
        config: requestConfig,
      };
      throw error;
    };

    const coverage = await controller.checkEligibility(eligibilityInquiry);
    expect(coverage).toEqual(coverageBody);
    expect(tokenCount).toBe(issuedAtStartup + 2);
    const lastTokenBody = String(tokenPost().mock.calls.at(-1)?.[1]);
    expect(lastTokenBody).toContain('grant_type=client_credentials');
    expect(lastTokenBody).toContain('scope=hipaa');

    logStep('Test 1 OAuth token refresh', {
      tokenUrl,
      cachedToken: cached,
      refreshedToken: refreshed,
      tokenAfter401: rest.getToken(),
      tokenRequests: tokenCount,
    });
  });

  it('posts a real-time eligibility inquiry to /availity/v1/coverages', async () => {
    handlePost = async () => ({ data: coverageBody });
    const coverage = await controller.checkEligibility(eligibilityInquiry);

    expect(mockHttp.post).toHaveBeenCalledWith(
      '/availity/v1/coverages',
      expect.objectContaining({
        payerId: eligibilityInquiry.payerId,
        memberId: eligibilityInquiry.memberId,
        serviceType: '30',
        patientFirstName: 'JOHN',
        patientLastName: 'DOE',
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Bearer poc-token-/) }),
      }),
    );
    expect(coverage).toMatchObject({ id: 'COV-44821', status: 'Active' });
    logStep('Test 2 eligibility coverage', coverage);
  });

  it('builds an 837P file and uploads it to /SendFiles/ on qa-files.availity.com', async () => {
    const claim = professionalClaim();
    const upload = await controller.submitBatchClaim(claim);
    const putCall = mockSftp.put.mock.calls.at(-1);
    const payload = Buffer.isBuffer(putCall?.[0]) ? putCall[0].toString('utf8') : '';
    const isa = payload.split('~')[0] ?? '';

    expect(mockSftp.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'qa-files.availity.com',
        port: 22,
        username: 'qa-user',
        password: 'qa-pass',
      }),
    );
    expect(putCall?.[1]).toBe(`/SendFiles/${upload.fileName}`);
    expect(isa.startsWith('ISA*00*')).toBe(true);
    expect(payload).toContain('ST*837*');
    expect(payload).toContain(`CLM*${SAMPLE_CLAIM_CONTROL_NUMBER}*185.00`);
    expect(payload).toContain('NM1*85*');
    expect(payload).toContain('REF*EI*123456789');
    expect(upload.remotePath).toBe(`/SendFiles/${upload.fileName}`);
    expect(upload.interchangeControlNumber).toMatch(/^\d{9}$/);

    mockSftp.list.mockResolvedValueOnce([{ name: `${upload.fileName}-success`, type: '-' }]);
    const notice = await controller.checkBatchStatus(upload.fileName);
    expect(notice).toMatchObject({
      status: 'SUCCESS',
      fileName: upload.fileName,
      notificationFile: `${upload.fileName}-success`,
    });

    logStep('Test 3 837P upload', {
      fileName: upload.fileName,
      remotePath: upload.remotePath,
      interchangeControlNumber: upload.interchangeControlNumber,
      claimControlNumber: upload.claimControlNumber,
      byteSize: upload.byteSize,
      notification: notice,
      isa,
    });
  });

  it('polls /ReceiveFiles and parses simulated IBR, EBR, and 999 responses', async () => {
    mockSftp.list.mockResolvedValueOnce([
      { name: 'batch.ibr', type: '-', size: Buffer.byteLength(sampleIbr), modifyTime: Date.parse('2026-09-28T14:32:00.000Z') },
      { name: 'ack.999', type: '-', size: Buffer.byteLength(sample999), modifyTime: Date.parse('2026-09-28T14:35:00.000Z') },
    ]);
    mockSftp.get.mockImplementation(async (remotePath: string) => {
      if (remotePath.endsWith('batch.ibr')) {
        return Buffer.from(sampleIbr);
      }
      if (remotePath.endsWith('ack.999')) {
        return Buffer.from(sample999);
      }
      return Buffer.from('');
    });

    const polled = await poller.pollReceiveFiles();
    const reports = controller.listReports();
    const ibr = polled.find((item) => item.fileName === 'batch.ibr')?.parsed as PipeDelimitedReport;
    const ack = polled.find((item) => item.fileName === 'ack.999')?.parsed as Acknowledgment999;
    const ebr = parser.parse(sampleEbr, 'batch.ebr') as PipeDelimitedReport;

    expect(ibr.reportType).toBe('IBR');
    expect(ibr.header).toMatchObject({
      batchId: SAMPLE_BATCH_ID,
      fileControlNumber: SAMPLE_FILE_CONTROL_NUMBER,
      totalSubmitted: 2,
      totalAccepted: 1,
      totalRejected: 1,
    });
    expect(ibr.claims[1].errors[0]).toMatchObject({
      code: 'E102',
      loop: '2010BA',
      segment: 'NM1',
      element: '09',
    });
    expect(ack.reportType).toBe('999');
    expect(ack.groupAcknowledgment.status).toBe('P');
    expect(ack.transactions[0].segmentErrors[0].segmentId).toBe('CLM');
    expect(ebr.reportType).toBe('EBR');
    expect(ebr.header.batchId).toBe('BAT-992088');
    expect(ebr.claims[0].status).toBe('A');
    expect(reports.count).toBe(2);

    logStep('Test 4 inbound reports', {
      polled: polled.map((item) => ({
        fileName: item.fileName,
        batchId: item.summary.batchId,
        status: item.summary.status,
        reportType: item.summary.reportType,
      })),
      ibrSummary: parser.summarize(ibr),
      ackSummary: parser.summarize(ack),
      ebrSummary: parser.summarize(ebr),
    });
  });

  it('submits and retrieves a claim status from /v1/claim-statuses', async () => {
    const submitted = { id: 'CS-1001', status: 'In Progress', patientControlNumber: SAMPLE_CLAIM_CONTROL_NUMBER };
    handlePost = async () => ({ data: submitted });
    handleGet = async () => ({ data: { id: 'CS-1001', status: 'Finalized', categoryCode: 'F1' } });

    const created = (await controller.submitClaimStatus(claimStatusQuery)) as { id: string };
    const retrieved = await controller.getClaimStatus(created.id);

    expect(mockHttp.post).toHaveBeenCalledWith(
      '/v1/claim-statuses',
      expect.objectContaining({
        payerId: '00001',
        providerNpi: '1234567893',
        memberId: 'MEM8941029',
        patientAccountNumber: SAMPLE_CLAIM_CONTROL_NUMBER,
        fromDate: '2026-09-10',
        toDate: '2026-09-10',
      }),
      expect.any(Object),
    );
    expect(mockHttp.get).toHaveBeenCalledWith('/v1/claim-statuses/CS-1001', expect.any(Object));
    expect(retrieved).toMatchObject({ id: 'CS-1001', status: 'Finalized' });

    logStep('Test 5 claim status', { submitted: created, retrieved });
  });
});
