Verdict: repo makes live Availity calls only — mocks confined to test/ and *.spec.ts.

## Summary

| path | Availity caller? | Hardcoded before? | Fallback before? | Status now | Verification command |
| --- | --- | --- | --- | --- | --- |
| `backend/src/availity-rest/availity-rest.service.ts` | Yes | Mock coverage (`MOCK-COV-*`) when credentials were placeholders | `catch` returned `mockCoverageResponse` | Throws `AvailityRestError`; 401 refreshes once then fails | `grep -n mockCoverage backend/src/availity-rest/availity-rest.service.ts` |
| `backend/src/sftp/sftp.service.ts` | Yes | Host default `qa-files.availity.com` | Per-file download errors were logged and skipped | Fresh connection, `SftpOperationError`, close in `finally`; `listSendFiles` / `listReceiveFiles` added | `grep -n SftpOperationError backend/src/sftp/sftp.service.ts` |
| `backend/src/sftp/sftp-poller.cron.ts` | Yes | No seed list | Parse errors were swallowed | Empty `ReceiveFiles` stays `[]`; parse failures rethrow | `grep -n "throw error" backend/src/sftp/sftp-poller.cron.ts` |
| `backend/src/edi/edi-parser.service.ts` | Parser only | No | Incomplete claim rows were still pushed | Missing patient name or control number is a `rowErrors` entry and is not a claim | `grep -n "return null" backend/src/edi/edi-parser.service.ts` |
| `backend/src/edi/x12-builder.service.ts` | Builds outbound X12 | `PROVIDER NAME`, `LASTNAME`, `8005551212`, submitter id `AV09311993` | `\|\|` name and id defaults | Missing names, submitter id, receiver id, or place of service throw | `grep -n "requiredText\|requiredConfig" backend/src/edi/x12-builder.service.ts` |
| `backend/src/controllers/availity.controller.ts` | Routes only | No mock return | None | Awaits services; errors hit the global filter | `grep -n "return this" backend/src/controllers/availity.controller.ts` |
| `backend/src/common/availity-exception.filter.ts` | Error shape | n/a | n/a | `{ error, op, upstream }` | `grep -n "upstream" backend/src/common/availity-exception.filter.ts` |
| `backend/src/config/availity.config.ts` | Config | `.default('sandbox')` on client id, secret, SFTP username | `AVAILITY_ALLOW_INCOMPLETE_CONFIG` defaulted true | Credentials `.required()` outside test; host default kept with the mismatch guard | `grep -nE "AVAILITY_(CLIENT_ID\|CLIENT_SECRET\|SFTP_USERNAME\|SFTP_PASSWORD).*default" backend/src/config/availity.config.ts` |
| `backend/src/config/availity-env.ts` | Boot guard | n/a | n/a | `validateAvailityConfigOrThrow` | `grep -n "Availity configuration missing" backend/src/config/availity-env.ts` |
| `backend/src/main.ts` | Boot | None | None | Guard runs before `AppModule` import so `.env` cannot refill `env -u` | `grep -n validateAvailityConfigOrThrow backend/src/main.ts` |
| `backend/src/app.module.ts` | Wiring | No seed provider | None | `AvailityConfigModule`, REST, EDI, SFTP, Optum, root controller | `grep -n imports backend/src/app.module.ts` |
| `backend/src/common/mock-data.seed.ts` | Was imported by the REST service and `run-poc-tests.ts` | Entire mock catalog | Yes | Deleted from `src`. Fixture lives at `backend/test/fixtures/mock-data.seed.ts` for the e2e spec only | `grep -Rn mock-data.seed backend/src` |
| `backend/src/scripts/run-poc-tests.ts` | Manual runner | Offline IBR/EBR/999 after a failed poll | Yes | Live poll only; a failed poll throws | `grep -n sampleIbr backend/src/scripts/run-poc-tests.ts` |
| `backend/src/scripts/run-optum-poc.ts` | Not imported by bootstrap | Called workflow methods with no body | Service substituted sample JSON | Passes an explicit body; missing report ids throw | `grep -n requireBody backend/src/optum/rcm-workflow.service.ts` |
| `backend/src/optum/*` | Optum only | Sandbox gateway URL fallbacks | Empty body became a canned member | No `AVAILITY_` reads; missing base URL or body throws | `grep -R AVAILITY_ backend/src/optum` |
| `backend/.env.example` | Docs for env | `sandbox` passwords and ids | `AVAILITY_ALLOW_INCOMPLETE_CONFIG=true` | Placeholder credentials; no mock switch | `head -5 backend/.env.example` |
| `frontend/src/lib/api.ts` | HTTP client | None | Fetch failures became a generic string; JSON parse failures became `{ message: text }` | `ApiError` with method, path, status, and body | `grep -n ApiError frontend/src/lib/api.ts` |
| `frontend/src/components/EligibilityTab.tsx` | UI | Sandbox presets and a mock badge | Result could render beside a swallowed fault | Initial result is `null`; loading, `ErrorPanel`, or data | `grep -n ErrorPanel frontend/src/components/EligibilityTab.tsx` |
| `frontend/src/components/BatchClaimTab.tsx` | UI | None for the receipt | Pending badge before the first status response | No badge until Availity returns a status | `grep -n "if (!notice)" frontend/src/components/BatchClaimTab.tsx` |
| `frontend/src/components/ReportsTab.tsx` | UI | None | `reports ?? []` | Empty copy is "No reports received from Availity yet."; a missing array throws | `grep -n "No reports received" frontend/src/components/ReportsTab.tsx` |
| `frontend/vite.config.ts` | Proxy | Had targeted port 5000 in the index | None | `/api` proxies to `http://localhost:3000` | `grep -n localhost frontend/vite.config.ts` |

## Diff summary

- `backend/src/common/mock-data.seed.ts` — deleted (was 224 lines). Moved to `backend/test/fixtures/mock-data.seed.ts`. `backend/test/availity-poc.e2e-spec.ts` imports that fixture. `run-poc-tests.ts` no longer imports it.
- `backend/src/availity-rest/availity-rest.service.ts` — removed the mock coverage branch, `AVAILITY_ALLOW_INCOMPLETE_CONFIG`, and placeholder-credential short circuit. Added `AvailityRestError` (`availity-rest.service.ts:34-47`). Token, coverage, and claim-status calls throw that error. A 401 refreshes the bearer token once and then throws. `expires_in` must be a positive number.
- `backend/src/sftp/sftp.service.ts` — `SftpOperationError` on connect, upload, notification check, download, `listSendFiles`, and `listReceiveFiles`. A missing receive directory throws. One failed file download fails the call. `PENDING` is returned only after a successful listing with no notification file.
- `backend/src/sftp/sftp-poller.cron.ts` — parse `catch` rethrows. Dedup `Set` and `running` guard kept.
- `backend/src/edi/edi-parser.service.ts` — `parseClaim` returns `null` when the patient name or control number is missing, and that row is only recorded in `rowErrors`. Header totals are no longer replaced with `claims.length`.
- `backend/src/edi/x12-builder.service.ts` — deleted `DEFAULT_SUBMITTER_ID` / `DEFAULT_RECEIVER_ID`, the fake PER phone, and name fallbacks. `build276ClaimStatusRequest` throws rather than emitting synthesized names.
- `backend/src/config/availity.config.ts` — credential Joi defaults removed. `AVAILITY_CLIENT_ID`, `AVAILITY_CLIENT_SECRET`, `AVAILITY_SFTP_USERNAME`, submitter id, and receiver id are `.required()` unless `NODE_ENV === 'test'`. `AVAILITY_SFTP_HOST` may still default to `qa-files.availity.com`, and the QA/production mismatch guard remains. `AVAILITY_ALLOW_INCOMPLETE_CONFIG` is gone.
- `backend/src/config/availity-env.ts` — `validateAvailityConfigOrThrow`. Re-exported from `availity.config.ts`. `main.ts` imports the helper from `availity-env.ts` so the check runs before `ConfigModule.forRoot` copies `.env` into `process.env`.
- `backend/src/main.ts` — calls the guard at `main.ts:7` before the dynamic `AppModule` import, and again at `main.ts:30` before `listen`. Registers `AvailityExceptionFilter`. Bootstrap failures call `process.exit(1)`.
- `backend/src/common/availity-exception.filter.ts` — new. Response body is `{ error, op, upstream }`.
- `backend/src/app.module.ts` — imports `AvailityConfigModule` directly. No seed or script provider.
- `backend/src/optum/optum-api.client.ts`, `optum-auth.service.ts`, `rcm-workflow.service.ts` — no sandbox URL fallback. Empty Optum bodies and missing report ids throw. No `AVAILITY_` reads in `src/optum/`, no `OPTUM_` reads in `src/availity-rest/` or `src/sftp/`.
- `backend/.env.example` — header `# No defaults. No mocks. App refuses to start without these.` Credential values replaced with `<REQUIRED — provisioned by Availity Client Services>`.
- `backend/tsconfig.build.json` — excludes `**/*.spec.ts`, `**/*.e2e-spec.ts`, `test/**`, and `src/scripts/**`.
- `backend/package.json` — `postbuild` fails if `dist/**/*.spec.js` exists. `glob@8.1.0` is a dev dependency so `g.sync` works.
- `frontend/src/lib/api.ts` — non-OK responses and network failures throw `ApiError` with the body attached. No `res.json().catch(() => ({}))`.
- `frontend/src/components/EligibilityTab.tsx` — deleted sandbox presets and the mock badge. Coverage state starts `null` and renders loading, `ErrorPanel`, or data.
- `frontend/src/components/BatchClaimTab.tsx` — no Pending badge until a notification response exists.
- `frontend/src/components/ReportsTab.tsx` — empty state text is "No reports received from Availity yet."
- `frontend/src/components/ui.tsx` — `ErrorPanel`.
- `frontend/vite.config.ts` — `/api` proxy target is `http://localhost:3000`. No mock middleware.

## Proof

```
# 1
$ grep -RnE "USE_MOCK|MOCK_|SKIP_AVAILITY|DRY_RUN|OFFLINE_MODE|FAKE_|STUB_" backend/src frontend/src || echo CLEAN
CLEAN

# 2
$ grep -Rn "mock-data.seed" backend/src || echo CLEAN
CLEAN

# 3
$ grep -Rn "sandbox" backend/src || echo CLEAN
CLEAN

# 4
$ grep -nE "AVAILITY_(CLIENT_ID|CLIENT_SECRET|SFTP_USERNAME|SFTP_PASSWORD).*default" backend/src/config/availity.config.ts || echo CLEAN
CLEAN

# 5
$ cd backend && env -u AVAILITY_CLIENT_ID -u AVAILITY_CLIENT_SECRET -u AVAILITY_SFTP_USERNAME -u AVAILITY_SFTP_PASSWORD npm run start:dev 2>&1 | head -20
npm warn Unknown env config "devdir". This will stop working in the next major version of npm.

> availity-poc-backend@1.0.0 start:dev
> nest start --watch

[2:43:38 PM] Starting compilation in watch mode...

[2:43:39 PM] Found 0 errors. Watching for file changes.

Error: Availity configuration missing. Set: AVAILITY_CLIENT_ID, AVAILITY_CLIENT_SECRET, AVAILITY_SFTP_USERNAME, AVAILITY_SFTP_PASSWORD|AVAILITY_SFTP_PRIVATE_KEY_PATH. See backend/.env.example. Nothing is mocked — the app cannot start without live Availity credentials.
    at validateAvailityConfigOrThrow (/Users/nikunj.rohit/Developer/Project/docs/POC-availity/backend/src/config/availity-env.ts:9:11)
    at bootstrap (/Users/nikunj.rohit/Developer/Project/docs/POC-availity/backend/src/main.ts:7:32)
    at Object.<anonymous> (/Users/nikunj.rohit/Developer/Project/docs/POC-availity/backend/src/main.ts:43:1)
    at Module._compile (node:internal/modules/cjs/loader:1706:14)
    at Object..js (node:internal/modules/cjs/loader:1839:10)
    at Module.load (node:internal/modules/cjs/loader:1441:32)
    at Function._load (node:internal/modules/cjs/loader:1263:12)
    at TracingChannel.traceSync (node:diagnostics_channel:328:14)
    at wrapModuleLoad (node:internal/modules/cjs/loader:237:24)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:171:5)

# same unset variables, compiled entry, no watch:
$ env -u AVAILITY_CLIENT_ID -u AVAILITY_CLIENT_SECRET -u AVAILITY_SFTP_USERNAME -u AVAILITY_SFTP_PASSWORD node dist/main.js
Error: Availity configuration missing. Set: AVAILITY_CLIENT_ID, AVAILITY_CLIENT_SECRET, AVAILITY_SFTP_HOST, AVAILITY_SFTP_USERNAME, AVAILITY_SFTP_PASSWORD|AVAILITY_SFTP_PRIVATE_KEY_PATH. See backend/.env.example. Nothing is mocked — the app cannot start without live Availity credentials.
node_exit:1

# 6
$ npm run build
> availity-poc-backend@1.0.0 build
> nest build

> availity-poc-backend@1.0.0 postbuild
> node -e "const fs=require('fs');const g=require('glob');const bad=g.sync('dist/**/*.spec.js');if(bad.length){console.error('SPEC FILES LEAKED INTO DIST:',bad);process.exit(1);}"
BUILD_OK

# 7
$ grep -RnE "\?\?\s*\{|\|\|\s*\[" frontend/src || echo CLEAN
CLEAN
```

`npm test` — 33 passed. `npm run test:e2e` — 5 passed. Frontend `tsc --noEmit` passed.

Update: `main.ts` now runs `process.loadEnvFile('.env')` before the guard, without overriding shell-exported values. With a populated `backend/.env`, `npm run start:dev` boots without exporting anything. Proof #5 still fails only when the credentials are missing from both the shell and `.env`. With no `.env` in the working directory, `node dist/main.js` prints `Availity configuration missing` and exits 1.

## Residual risks

1. Pipe-delimited optional columns still become empty strings (`parts[n] || ''` in `edi-parser.service.ts`). A row that is missing the patient name or control number is not turned into a claim; it is only a `rowErrors` string. Header totals of `0` are kept rather than replaced with a counted length. Risk #1.
2. `build276ClaimStatusRequest` throws. It used to emit `PAYER NAME` / `PATIENT LAST`. Claim status in this app is the REST call. Risk #2 if something still expected a synthesized 276.
3. `optum.contracts.ts` still contains Optum's published example request bodies. `RcmWorkflowService` does not send them unless the caller passes that object. `run-optum-poc.ts` does, on purpose.
4. `SftpService.close` logs a failed `end()` and does not rethrow, so a close error cannot replace the operation result.
5. `nest start --watch` keeps the TypeScript watcher up after the app process calls `process.exit(1)`. `node dist/main.js` with the credentials unset exits 1.
6. The batch claim form still starts with sample field values. The upload receipt and notification status start as `null`, and the UI does not show Pending before Availity responds.
