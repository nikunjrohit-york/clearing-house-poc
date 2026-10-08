import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { AppModule } from '../app.module';
import { claimStatusRequest, eligibilityRequest, professionalClaimRequest } from '../optum/optum.contracts';
import { RcmWorkflowService, StepAudit } from '../optum/rcm-workflow.service';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const steps = [
  { key: '0', name: 'OAuth token', run: (workflow: RcmWorkflowService) => workflow.authenticate() },
  { key: '1', name: 'Eligibility 270/271', run: (workflow: RcmWorkflowService) => workflow.checkEligibility(eligibilityRequest(requiredEnv('OPTUM_TRADING_PARTNER_ID'))) },
  { key: '2', name: 'Professional claim 837P', run: (workflow: RcmWorkflowService) => workflow.submitProfessionalClaim(professionalClaimRequest()) },
  { key: '3', name: '277CA report', run: (workflow: RcmWorkflowService) => workflow.fetch277(requiredEnv('OPTUM_277_REPORT_ID')) },
  { key: '4', name: 'Claim status 276/277', run: (workflow: RcmWorkflowService) => workflow.queryClaimStatus(claimStatusRequest('28.75')) },
  { key: '5', name: '835 remittance', run: (workflow: RcmWorkflowService) => workflow.fetch835(requiredEnv('OPTUM_835_REPORT_ID')) },
];

function banner(title: string) {
  console.log(`\n${'─'.repeat(72)}\n${title}\n${'─'.repeat(72)}`);
}

function printAudit(audit: StepAudit<unknown>) {
  console.log(
    JSON.stringify(
      audit,
      (key, value) => {
        if (key === 'access_token' && typeof value === 'string') return `${value.slice(0, 6)}…`;
        if (key === 'client_secret') return '***';
        return value;
      },
      2,
    ),
  );
}

async function choose(): Promise<string> {
  if (process.argv.includes('--all') || !input.isTTY) {
    console.log('Running the Optum end-to-end suite.');
    return 'all';
  }
  const rl = createInterface({ input, output });
  console.log('\nOptum clearinghouse PoC');
  for (const step of steps) console.log(`  ${step.key}) ${step.name}`);
  console.log('  a) Run end-to-end test suite');
  console.log('  q) Quit');
  const answer = (await rl.question('\nSelect a step: ')).trim().toLowerCase();
  rl.close();
  return answer;
}

async function main() {
  Logger.overrideLogger(['error', 'warn', 'log']);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const workflow = app.get(RcmWorkflowService);
  try {
    const choice = await choose();
    if (choice === 'q' || choice === 'quit') return;
    const selected = choice === 'a' || choice === 'all' ? steps : steps.filter((step) => step.key === choice);
    if (selected.length === 0) {
      console.log(`Unknown step "${choice}". Use 0-5, a, or q.`);
      process.exitCode = 1;
      return;
    }

    const results: StepAudit<unknown>[] = [];
    for (const step of selected) {
      banner(step.name);
      try {
        const audit = await step.run(workflow);
        printAudit(audit);
        console.log(`\n${audit.ok ? 'PASS' : 'FAIL'}  ${step.name}`);
        results.push(audit);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.log(`\nFAIL  ${step.name}`);
        console.log(message);
        if (error && typeof error === 'object' && 'getResponse' in error && typeof error.getResponse === 'function') {
          console.log(JSON.stringify(error.getResponse(), null, 2));
        }
        results.push({
          step: step.key,
          ok: false,
          calls: [],
          parsed: null,
          error: { httpStatus: 500, description: message, error: 'error', traceId: '', applicationMode: '' },
        });
      }
    }

    banner('PoC summary');
    console.log(JSON.stringify(results.map((result) => ({ step: result.step, status: result.ok ? 'PASS' : 'FAIL', httpStatus: result.error?.httpStatus ?? result.calls.at(-1)?.httpStatus ?? null })), null, 2));
    if (results.some((result) => !result.ok)) process.exitCode = 1;
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
