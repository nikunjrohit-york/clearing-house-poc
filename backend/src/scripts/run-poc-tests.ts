import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { AppModule } from '../app.module';
import { AvailityRestService } from '../availity-rest/availity-rest.service';
import { ClaimStatusQueryDto } from '../availity-rest/dto/claim-status-query.dto';
import { CoverageInquiryDto } from '../availity-rest/dto/coverage-inquiry.dto';
import { ClaimFrequencyCode, ClaimInputDto, ClaimType, PlaceOfService } from '../edi/dto/claim-input.dto';
import { X12BuilderService } from '../edi/x12-builder.service';
import { SftpPollerCron } from '../sftp/sftp-poller.cron';
import { SftpService } from '../sftp/sftp.service';

const eligibilityInquiry: CoverageInquiryDto = {
  payerId: '00001',
  memberId: 'MEM8941029',
  patientFirstName: 'JOHN',
  patientLastName: 'DOE',
  patientBirthDate: '1985-04-12',
  patientGender: 'M',
  serviceTypeCode: '30',
  providerNpi: '1234567893',
  serviceDate: '2026-09-10',
};

const claimStatusQuery: ClaimStatusQueryDto = {
  payerId: '00001',
  providerNpi: '1234567893',
  memberId: 'MEM8941029',
  patientFirstName: 'JOHN',
  patientLastName: 'DOE',
  patientBirthDate: '1985-04-12',
  patientControlNumber: 'PCN-2023-001',
  serviceDate: '2026-09-10',
};

function professionalClaim(claimControlNumber: string): ClaimInputDto {
  return {
    claimType: ClaimType.PROFESSIONAL,
    tradingPartnerId: '00001',
    claimControlNumber,
    frequencyCode: ClaimFrequencyCode.ORIGINAL,
    billingProvider: {
      npi: '1234567893',
      taxId: '12-3456789',
      name: 'RIVERSIDE FAMILY CLINIC',
      address1: '1200 RIVERPLACE BLVD',
      city: 'JACKSONVILLE',
      state: 'FL',
      zip: '32207',
    },
    subscriber: {
      memberId: 'MEM8941029',
      firstName: 'JOHN',
      lastName: 'DOE',
      dateOfBirth: '1985-04-12',
      gender: 'M',
    },
    diagnoses: [{ code: 'J06.9' }],
    serviceLines: [
      {
        lineNumber: 1,
        serviceDate: '2026-09-10',
        procedureCode: '99213',
        quantity: 1,
        unitPrice: 150,
        diagnosisPointer: '1',
        placeOfService: PlaceOfService.OFFICE,
      },
    ],
    totalCharge: 150,
  };
}

interface StepResult {
  name: string;
  ok: boolean;
  detail: string;
}

const steps = [
  { key: '1', name: 'REST Eligibility Check', run: runEligibility },
  { key: '2', name: 'X12 837 EDI Generation', run: runEdi },
  { key: '3', name: 'SFTP Upload & Notification Check', run: runSftpUpload },
  { key: '4', name: 'SFTP Inbound Download & Parsing', run: runInbound },
  { key: '5', name: 'REST Claim Status Query', run: runClaimStatus },
];

let restService: AvailityRestService;
let x12Builder: X12BuilderService;
let sftpService: SftpService;
let poller: SftpPollerCron;
let lastEdi = '';
let lastFileName = '';

function banner(title: string) {
  console.log(`\n${'─'.repeat(72)}\n${title}\n${'─'.repeat(72)}`);
}

function printJson(label: string, value: unknown) {
  console.log(`\n${label}`);
  console.log(JSON.stringify(value, null, 2));
}

function interchangeControlNumber(edi: string): string {
  const isa = edi.split('~')[0] ?? '';
  return isa.split('*')[13] ?? '';
}

function claimStatusId(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const record = payload as { id?: unknown; claimStatuses?: { id?: unknown }[] };
  if (typeof record.id === 'string' && record.id.trim()) {
    return record.id.trim();
  }
  const nested = record.claimStatuses?.[0]?.id;
  return typeof nested === 'string' ? nested.trim() : '';
}

async function runEligibility(): Promise<void> {
  printJson('Eligibility request', eligibilityInquiry);
  const coverage = await restService.checkEligibility(eligibilityInquiry);
  printJson('Eligibility response', coverage);
}

async function runEdi(): Promise<void> {
  const controlNumber = `PCN${Date.now().toString().slice(-8)}`;
  const claim = professionalClaim(controlNumber);
  lastEdi = x12Builder.build837Claim(claim);
  const icn = interchangeControlNumber(lastEdi);
  lastFileName = `BATCH_${icn}.txt`;
  const segments = lastEdi.split('~').filter((segment) => segment.length > 0);
  printJson('837P claim input', claim);
  printJson('837P envelope', {
    batchFileName: lastFileName,
    claimControlNumber: controlNumber,
    interchangeControlNumber: icn,
    segmentCount: segments.length,
    byteSize: Buffer.byteLength(lastEdi),
    isa: segments[0],
    gs: segments.find((segment) => segment.startsWith('GS*')),
    st: segments.find((segment) => segment.startsWith('ST*')),
  });
  console.log('\n837P EDI');
  console.log(lastEdi);
}

async function runSftpUpload(): Promise<void> {
  if (!lastEdi) {
    await runEdi();
  }
  console.log(`Uploading ${lastFileName} to qa-files.availity.com:/SendFiles/`);
  const upload = await sftpService.uploadBatchFile(lastFileName, lastEdi);
  printJson('SFTP upload receipt', upload);
  const notice = await sftpService.checkUploadNotification(lastFileName);
  printJson('Upload notification', notice);
  if (notice.status === 'PENDING') {
    console.log('Availity has not posted a -success or -FAILED file yet.');
  }
}

async function runInbound(): Promise<void> {
  console.log('Polling /ReceiveFiles/');
  const polled = await poller.pollReceiveFiles();
  printJson(
    'Inbound poll',
    polled.map((item) => ({
      fileName: item.fileName,
      modifiedAt: item.modifiedAt,
      summary: item.summary,
    })),
  );
}

async function runClaimStatus(): Promise<void> {
  printJson('Claim status request', claimStatusQuery);
  const submitted = await restService.submitClaimStatus(claimStatusQuery);
  printJson('POST /v1/claim-statuses', submitted);
  const id = claimStatusId(submitted);
  if (!id) {
    console.log('Submit response did not include an id, so the follow-up GET was not sent.');
    return;
  }
  const retrieved = await restService.getClaimStatus(id);
  printJson(`GET /v1/claim-statuses/${id}`, retrieved);
}

async function runNamed(name: string, action: () => Promise<void>): Promise<StepResult> {
  banner(name);
  try {
    await action();
    console.log(`\nPASS  ${name}`);
    return { name, ok: true, detail: 'completed' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.log(`\nFAIL  ${name}`);
    console.log(message);
    return { name, ok: false, detail: message };
  }
}

async function choose(): Promise<string> {
  if (process.argv.includes('--all') || !input.isTTY) {
    console.log('Running all PoC steps.');
    return 'all';
  }

  const rl = createInterface({ input, output });
  console.log('\nAvaility PoC runner');
  for (const step of steps) {
    console.log(`  ${step.key}) ${step.name}`);
  }
  console.log('  a) Run all');
  console.log('  q) Quit');
  const answer = (await rl.question('\nSelect a step: ')).trim().toLowerCase();
  rl.close();
  return answer;
}

async function main() {
  Logger.overrideLogger(['error', 'warn']);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  restService = app.get(AvailityRestService);
  x12Builder = app.get(X12BuilderService);
  sftpService = app.get(SftpService);
  poller = app.get(SftpPollerCron);

  try {
    const choice = await choose();
    if (choice === 'q' || choice === 'quit') {
      return;
    }

    const selected = choice === 'a' || choice === 'all' ? steps : steps.filter((step) => step.key === choice);
    if (selected.length === 0) {
      console.log(`Unknown step "${choice}". Use 1-5, a, or q.`);
      process.exitCode = 1;
      return;
    }

    const results: StepResult[] = [];
    for (const step of selected) {
      results.push(await runNamed(step.name, step.run));
    }

    banner('PoC summary');
    printJson(
      'Results',
      results.map((result) => ({ step: result.name, status: result.ok ? 'PASS' : 'FAIL', detail: result.detail })),
    );
    if (results.some((result) => !result.ok)) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
  });
}
