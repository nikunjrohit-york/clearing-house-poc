# Availity Integration Guide

Architectural description of the Availity clearinghouse integration in this repository: how data moves, what is already wired through, what is still outstanding, and how the Developer Portal, QA Essentials, and environment variables fit together.

Availity is one of two clearinghouses in the dashboard. Optum uses `OPTUM_*` configuration and `backend/src/optum/`. It does not share a client, token, or route with Availity.

Contract-specific values that are not in this repository are marked `[FILL IN: …]`.

---

## 1. Architectural overview

### 1.1 System context

The integration is a NestJS process and a React dashboard. The browser never calls Availity. It calls this application, and the application calls Availity on one of two channels.

| Channel | Availity product | Used for |
|---|---|---|
| HTTPS REST, OAuth 2.0 client credentials | Healthcare HIPAA Transactions, plus the Payment Accuracy edits resource | Eligibility, pre-submit 837 edits, single-claim status |
| SFTP to the managed file gateway | Batch EDI | 837P submission, upload notifications, IBR/EBR/DPR/999/TA1 retrieval |

Claim submission and remittance advice are batch files. Eligibility and claim status are real-time REST calls. Pre-submit edits are a third REST call: the application generates an 837P locally, sends that payload to Payment Accuracy, and only then uploads the same payload over SFTP.

```text
Browser
  React dashboard  :5173
  Availity tabs: Eligibility | Batch 837 Builder | Live Reports
        |
        |  /api/*   Vite dev proxy
        v
NestJS  :3000
  AvailityController          /api/availity/*
  AvailityRestService         OAuth + JSON/form calls
  X12BuilderService           837P (005010X222A1)
  EdiParserService            inbound pipe reports and 999/TA1
  SftpService                 one connection per operation
  SftpPollerCron              /ReceiveFiles every 15 minutes, in-memory store
        |
        +-- HTTPS --> api.availity.com
        |
        +-- SFTP  --> qa-files.availity.com:22     (QA, ISA15=T)
                      files.availity.com:22        (production, ISA15=P)
                      /SendFiles    outbound 837 and upload notifications
                      /ReceiveFiles inbound acknowledgements and reports
```

There is no database. Configuration is environment variables validated at boot. Parsed inbound reports live in a `Map` on `SftpPollerCron` and are gone when the process stops. Interchange control numbers are the exception: `X12BuilderService` persists ISA13 outside the process so a restart does not reuse a control number.

### 1.2 Components

**Dashboard (`frontend/src`).** `App.tsx` switches between Availity and Optum. On the Availity side it mounts one tab at a time:

| Tab | Component | Application calls |
|---|---|---|
| Eligibility | `EligibilityTab` | `POST /api/availity/eligibility` |
| Batch 837 Builder | `BatchClaimTab` | `POST /api/availity/claims/validate`, then `POST /api/availity/claims/batch-submit`, then `GET /api/availity/claims/batch-status/:fileName` |
| Live Reports | `ReportsTab` | `GET /api/availity/reports`, `POST /api/availity/reports/poll` |

`frontend/src/lib/api.ts` is the only HTTP client. It sends JSON and surfaces the response body on any non-2xx status. `frontend/vite.config.ts` proxies `/api` to `http://localhost:3000`, so the browser talks only to the Vite origin.

**HTTP boundary (`AvailityController`).** All Availity routes sit under `/api/availity`. The controller does not contain vendor logic. It validates the body, calls a service, and returns that service’s result.

| Method | Path | Work |
|---|---|---|
| `POST` | `/api/availity/eligibility` | Coverage inquiry |
| `POST` | `/api/availity/claims/validate` | Build 837P, send it to Payment Accuracy, return edits plus the X12 |
| `POST` | `/api/availity/claims/batch-submit` | Build 837P, upload `BATCH_<ISA13>.txt` to `/SendFiles` |
| `GET` | `/api/availity/claims/batch-status/:fileName` | Read the upload notification from `/SendFiles` |
| `POST` | `/api/availity/claim-status` | Submit a claim-status inquiry |
| `GET` | `/api/availity/claim-status/:id` | Read a claim-status result |
| `GET` | `/api/availity/reports` | List reports already parsed in this process |
| `POST` | `/api/availity/reports/poll` | Download `/ReceiveFiles` now, parse, then list |

Global pipes whitelist and transform bodies. `AvailityExceptionFilter` turns service failures into `{ error, op, upstream }` and keeps the upstream HTTP status.

**REST client (`AvailityRestService`).** One Axios instance pointed at `AVAILITY_BASE_URL`. On module init it obtains a token. The token is cached until 60 seconds before `expires_in` (Availity issues about 300 seconds). Concurrent callers share one in-flight token request. A 401 refreshes the bearer once and retries. 502, 503, and 504 retry with backoff, up to three times. Every other upstream status is returned as-is.

**EDI builder (`X12BuilderService`).** `build837Claim` is the method on the live path. It checks the QA/production pairing (`AVAILITY_SFTP_HOST` with `AVAILITY_USAGE_INDICATOR`), applies companion-guide edits, and emits a HIPAA 5010 professional claim (`005010X222A1`). Envelope identifiers come from configuration: submitter id in ISA06, receiver id in ISA08 (`030240928` unless `AVAILITY_RECEIVER_ID` overrides it), usage indicator in ISA15. Delimiters are `*` (element), `:` (component), `~` (segment), `^` (repetition).

`build270EligibilityRequest` and `build276ClaimStatusRequest` exist in the same service. The running eligibility and claim-status routes do not call them. Those routes use the REST APIs below.

**EDI parser (`EdiParserService`).** `parse` classifies a downloaded file and returns a structured report. Pipe-delimited IBR, IBRP, EBR, and DPR become claim rows (patient, date, control number, charge, billing id, status, and note groups). X12 999 and TA1 become acknowledgement results. A row missing a patient name or control number is recorded as a row error and is not stored as a claim. `summarize` produces the counts the poller logs.

**SFTP (`SftpService`).** Each upload, listing, or download opens a connection and closes it in `finally`. Authentication is the mailbox password or a PEM key, never both. Remote directories come from `AVAILITY_SFTP_SEND_PATH` and `AVAILITY_SFTP_RECEIVE_PATH`.

**Poller (`SftpPollerCron`).** A cron of `0 */15 * * * *` downloads `/ReceiveFiles`. A `running` flag skips a tick that overlaps the previous one. Files already seen (name, size, and modified time) are skipped. New files are parsed and stored in memory. `POST /api/availity/reports/poll` calls the same method.

**Configuration.** `AvailityConfigModule` loads `.env.local` and `.env` through Joi. `main.ts` also runs `validateAvailityConfigOrThrow` before the Nest application is constructed, so a missing credential stops the process. Outside `NODE_ENV=test` there is no substitute client and no canned vendor response.

### 1.3 Data flows

**Eligibility.**

```text
EligibilityTab
  POST /api/availity/eligibility          CoverageInquiryDto
    -> AvailityRestService.checkEligibility
         -> POST /availity/v1/token         (only when the cache is cold)
         -> POST /availity/v1/coverages     application/x-www-form-urlencoded
         -> GET  /availity/v1/coverages/{id}
              repeated while statusCode is 0
              interval AVAILITY_COVERAGE_POLL_INTERVAL_MS (2000)
              attempts AVAILITY_COVERAGE_POLL_ATTEMPTS (15)
              stop on statusCode 3 or 4
    <- coverage JSON to the tab
```

The form body carries payer id, provider NPI, member id, patient name, birth date, optional gender, `serviceType[]` from `serviceTypeCode`, optional procedure code, and `submitterId` from `AVAILITY_SUBMITTER_ID`.

**Claim validation (`POST /api/availity/claims/validate`).**

```text
BatchClaimTab claim form
  POST /api/availity/claims/validate       ClaimInputDto
    -> X12BuilderService.build837Claim     local 837P string
    -> AvailityRestService.validateClaimX12
         -> POST /api/v1/payment-accuracy/x12/edits
              {
                payload: "<837P>",
                traceIdentifier: "<uuid>",
                customerIdentifier: "<billing tax id NN-NNNNNNN>",
                payerIdentifier: "<tradingPartnerId>",
                lineOfBusiness: "COM"
              }
    <- {
         valid: triggeredResult.length === 0,
         triggeredResult,
         transactionIdentifier,
         x12Payload
       }
```

The Batch tab treats this response as a gate. On submit it calls validate again, and it uploads only when no entry in `triggeredResult` has severity `error`.

**Batch submission and notification.**

```text
BatchClaimTab
  POST /api/availity/claims/batch-submit
    -> build837Claim
    -> read ISA13 (9 digits) from the first segment
    -> SftpService.uploadBatchFile
         file name BATCH_<ISA13>.txt
         directory /SendFiles
    <- file name, remote path, size, uploadedAt, claim control number, status URL

  GET /api/availity/claims/batch-status/:fileName
    -> SftpService.checkUploadNotification
         looks in /SendFiles for <file>-success or <file>-FAILED
         also accepts the batch-id form <file>-<digits>-success|-FAILED
    <- UPLOADED notification state, or PENDING when the listing succeeds and no notification is present yet
```

**Inbound reports.**

```text
cron every 15 minutes, or ReportsTab "Poll"
  POST /api/availity/reports/poll
    -> SftpService.downloadReceiveFiles      /ReceiveFiles
    -> EdiParserService.parse + summarize
    -> Map keyed by file name
  GET /api/availity/reports
    <- { count, reports }
```

**Claim status (API only).**

```text
POST /api/availity/claim-status          ClaimStatusQueryDto
  -> POST /v1/claim-statuses
       payer, NPI, member, patient, patientAccountNumber,
       submitterId, fromDate, toDate
GET  /api/availity/claim-status/:id
  -> GET  /v1/claim-statuses/{id}
```

No Availity tab calls these two routes today. The builders for a batch 276 file are also unused by the controller.

### 1.4 What each Availity API is in this design

| Application action | Availity resource | Role in the design |
|---|---|---|
| Token | `POST {AVAILITY_TOKEN_URL}` default `https://api.availity.com/availity/v1/token` | `grant_type=client_credentials`, `client_id`, `client_secret`, optional `scope` and `realm`. Bearer on every later REST call |
| Eligibility | `POST` and `GET /availity/v1/coverages` | Real-time 270/271. Async: create, then poll by id |
| Pre-submit edits | `POST /api/v1/payment-accuracy/x12/edits` | Accepts the 837P this app just built. Returns `triggeredResult` |
| Claim status | `POST` and `GET /v1/claim-statuses` | Real-time 276/277 for one claim. Same async shape as Coverages |
| File drop | SFTP `/SendFiles` | The 837P submission. Availity writes a success or failure notification back into this folder |
| File pickup | SFTP `/ReceiveFiles` | ACK, TA1, 999, IBR/IBRP, EBR, DPR, and ERA/835 after enrollment |

On QA, batch validate and submit call `GET /availity/v1/availity-payer-list?payerId=<id>&transactionType=837P` before building the 837P. The sandbox payer `AVAILITY` skips that lookup. `00001` and `61001` are not Availity 837P payers. The QA default is `AVAILITY`. Other test ids are `00020` (Aetna), `00180` (Humana), `00300` (Cigna), and `14303` (American Family). Configurations (`GET /v1/configurations`) are not called. Patient Cost Estimator (`/availity/v1/professional-claims`) is a predetermination product. This design does not use it as claim submission.

### 1.5 Working 837P batch payload

`POST /api/availity/claims/validate` and `POST /api/availity/claims/batch-submit` take the same `ClaimInputDto`. Validate returns edits. Batch-submit uploads the 837P and answers **202 Accepted** with the SFTP receipt.

The body below is the shape that produced a successful QA upload. `tradingPartnerId` and `claimControlNumber` sit on the root. `placeOfService` is sent on the claim and on every service line. `frequencyCode` is `1` through `8` (original is `1`). Billing `name` is the organization name when a personal name is not supplied. Subscriber birth date is `birthDate` (`YYYY-MM-DD`). Addresses are nested. The primary diagnosis cannot start with `E`. Each `lineNumber` is its 1-based position, and `diagnosisPointer` is a string.

```json
{
  "claimType": "professional",
  "tradingPartnerId": "AVAILITY",
  "claimControlNumber": "CLM123456",
  "frequencyCode": "1",
  "placeOfService": "11",
  "billingProvider": {
    "name": "The Delphi Group LLC",
    "organizationName": "The Delphi Group LLC",
    "npi": "1194476978",
    "taxId": "27-2499372",
    "address": {
      "address1": "100 Main St",
      "city": "Concord",
      "state": "NH",
      "zip": "03301"
    }
  },
  "subscriber": {
    "firstName": "John",
    "lastName": "Doe",
    "memberId": "MEM123456",
    "birthDate": "1980-01-01",
    "gender": "M",
    "address": {
      "address1": "200 Elm St",
      "city": "Concord",
      "state": "NH",
      "zip": "03301"
    }
  },
  "diagnoses": [
    { "code": "I10" }
  ],
  "serviceLines": [
    {
      "lineNumber": 1,
      "procedureCode": "99213",
      "quantity": 1,
      "unitPrice": 100.00,
      "serviceDate": "2026-03-01",
      "placeOfService": "11",
      "diagnosisPointer": "1"
    }
  ],
  "totalCharge": 100.00
}
```

`POST /api/availity/claims/batch-submit` responds 202:

```json
{
  "fileName": "BATCH_765617208.txt",
  "remotePath": "/SendFiles/BATCH_765617208.txt",
  "byteSize": 640,
  "uploadedAt": "2026-10-09T06:38:58.374Z",
  "status": "UPLOADED",
  "claimControlNumber": "CLM123456",
  "interchangeControlNumber": "765617208",
  "statusUrl": "/api/availity/claims/batch-status/BATCH_765617208.txt"
}
```

`fileName` is `BATCH_` plus the 9-digit ISA13. `statusUrl` is the notification poll for that file. The interchange control number changes on every build.

Local rules enforced by `ClaimInputDto` and `X12BuilderService` before the SFTP upload:

- Professional claims only on the 837P builder.
- `tradingPartnerId` and `claimControlNumber` are required strings.
- `frequencyCode` is `1`–`8`. An empty value becomes `1`. The builder still refuses frequency `6` (corrected) under the companion-guide edit.
- `placeOfService` is required on the claim and on each service line. An empty value becomes `11`.
- Billing NPI is 10 digits and passes the NPI checksum. Tax id matches `NN-NNNNNNN`.
- Billing `name` is copied from `organizationName` when name is blank, and the reverse when only name is sent.
- Billing and subscriber addresses require `address1`, `city`, `state`, and a ZIP of 5 or 9 digits with no dash.
- Subscriber `gender` is `M` or `F`. `birthDate` and each `serviceDate` are `YYYY-MM-DD`.
- `diagnoses` is `[{ code }]`. `diagnoses[0].code` cannot start with `E`.
- `lineNumber` is the 1-based index of that line. `diagnosisPointer` is a string such as `"1"`.
- `totalCharge` equals the cent-exact sum of `quantity × unitPrice`.
- At most 50 service lines. Service dates must be before the UTC day the 837 is built.
- ISA15 `P` is refused when the host is `qa-files.availity.com`, and ISA15 `T` is refused when the host is `files.availity.com`, unless `AVAILITY_ALLOW_ENV_MISMATCH=true`.

The Batch 837 Builder tab applies the same defaults before it posts: frequency `1`, place of service `11` on the claim and every line, sequential `lineNumber`, `diagnosisPointer` `"1"`, and billing `name` set from the organization name. It blocks a primary diagnosis that starts with `E` before the request leaves the browser. A 403 from pre-validation shows a warning and still allows the SFTP upload. The checkbox **Submit Directly via SFTP (Skip Pre-Validation)** posts to `/api/availity/claims/batch-submit` without calling validate.

`CoverageInquiryDto` and `ClaimStatusQueryDto` are the eligibility and claim-status bodies. They stay on the REST channel and never become an X12 file in the running application.

---

## 2. Implementation diagnosis

Assessment of the tree as it stands. “Integrated” means the UI or HTTP route, the domain service, and the Availity channel are connected and the process will perform that call with live credentials.

### 2.1 Integrated end to end

**1. Boot and configuration.** `main.ts` loads `backend/.env`, then refuses to start unless the REST client id and secret, the SFTP host and username, and either a password or a private-key path are set. Joi repeats that check and also requires submitter id and receiver id. QA host and test indicator are paired, as are the production host and production indicator.

**2. OAuth.** `AvailityRestService` requests a client-credentials token from `AVAILITY_TOKEN_URL` at startup, caches it, and attaches it to later calls. Scope defaults to `hipaa`. Realm is sent only when `AVAILITY_REALM` is set.

**3. Eligibility.** The Eligibility tab posts a coverage inquiry. The REST service submits `POST /availity/v1/coverages` and polls `GET /availity/v1/coverages/{id}` until the status code leaves `0` or the attempt budget runs out. This is the HIPAA transaction confirmed on the Demo subscription in support case 18993019.

**4. 837P generation.** `build837Claim` produces a 5010 professional claim from `ClaimInputDto`, including the Availity envelope (submitter, receiver `030240928`, delimiters, ISA15) and a persisted interchange control number.

**5. Pre-submit validation.** `POST /api/availity/claims/validate` is wired from the Batch tab through the controller to `validateClaimX12`. The generated 837P is the `payload`. The billing tax id is `customerIdentifier`. The trading partner id is `payerIdentifier`. Line of business is the constant `COM`. The tab renders `triggeredResult` and uses error-severity edits as the gate in front of upload.

**6. Batch upload.** `POST /api/availity/claims/batch-submit` uploads that 837P to `/SendFiles` as `BATCH_<ISA13>.txt`. The status route then looks for Availity’s success or failure notification in the same folder. The Batch tab polls that status URL after a successful upload.

**7. Inbound acknowledgement and claim reports.** The 15-minute poller and the Live Reports poll button download `/ReceiveFiles`, parse IBR, IBRP, EBR, DPR, 999, and TA1, and show the in-memory list. Duplicate files are skipped. A malformed row does not discard the rest of the file.

**8. Failure shape.** REST and SFTP failures leave the service as typed errors. The filter returns `error`, `op`, and `upstream` so the dashboard can show the operation that failed. The REST client refreshes once on 401 and retries only gateway timeouts.

### 2.2 Present in the codebase, not on the Availity user path

| Piece | Where | State |
|---|---|---|
| `build270EligibilityRequest` | `X12BuilderService` | Implemented. Eligibility runs through Coverages REST, so this builder has no controller caller |
| `build276ClaimStatusRequest` | `X12BuilderService` | Implemented. No controller caller. Live claim status, where used, is REST |
| `POST /api/availity/claim-status` and `GET /api/availity/claim-status/:id` | `AvailityController`, `AvailityRestService` | Backend route and Availity client are in place. The Availity half of the dashboard has no tab that calls them |
| `listSendFiles` / `listReceiveFiles` | `SftpService` | Used by notification check and download. No separate admin API |
| Optum workflow | `backend/src/optum`, Optum tabs | A second clearinghouse in the same shell. It starts as the default house in `App.tsx`. It is not an Availity component |

### 2.3 Not built yet

| Gap | Why it is still open |
|---|---|
| ERA/835 ingestion | `/ReceiveFiles` can hold `.era` files after per-payer enrollment. `EdiParserService` does not turn an 835 into payments, and there is no posting API |
| 837I and 837D | The claim-type enum includes institutional and dental. `build837Claim` emits professional only |
| Durable report and batch store | Poll results and upload state are process memory. A restart clears the Live Reports list. Production needs a database keyed by file name and ISA13 |
| Push delivery | Availity does not offer a file webhook. The design is poll-based, which is already implemented; a queue or external scheduler is not |
| Payer rules from Configurations | Required fields are the local DTO and companion-guide checks. Per-payer configuration is not fetched or cached |
| Payer-list sync | The channel and contract flag per payer are not stored locally |
| Oxygen-therapy and home-health segments | Claims that set `oxygenTherapy` or `homeHealth` are rejected until the procedure-code map is confirmed |
| Medicare SSN edit | Payer ids that should be treated as Medicare are not confirmed, so that edit is not applied from a maintained list |

### 2.4 Portal and contract items still outside the code

These are configuration and enrollment tasks. The code paths exist; the Availity account has to authorize them.

| Item | Status to confirm |
|---|---|
| Developer Portal app subscribed to Coverages | Required for the eligibility flow. Demo subscription is the one the support case verified |
| Same app subscribed to the product that serves `POST /api/v1/payment-accuracy/x12/edits` | Required for `/api/availity/claims/validate` to be accepted. Scope and `customerIdentifier` (billing TIN versus Availity customer id) must match that product’s reference. `[FILL IN: product name, scope string, identifier type]` |
| Same app subscribed to Claim Statuses | Required before the claim-status routes are a supported integration. `[FILL IN: included in current plan, or separate subscription]` |
| QA mailbox on `qa-files.availity.com` | Required for batch upload and report poll. Username and password are the mailbox, not the Essentials login |
| EDI reporting preferences | Decide which of ACK, 999, IBR/IBRP, EBR, DPR, 277CA, and ERA land in `/ReceiveFiles`, and the grouping (organization, provider, or payer). `[FILL IN: preferences currently selected]` |
| ERA enrollment per payer | Required before 835 files arrive. Independent of 837 submission enrollment. `[FILL IN: payers already enrolled]` |
| Production mailbox and Standard-plan API credentials | Not implied by the QA mailbox or the Demo key. `[FILL IN: production client id provisioned, production mailbox provisioned]` |
| Trading partner ids | `AVAILITY_SUBMITTER_ID` and `AVAILITY_RECEIVER_ID` must be the ids Availity assigned. Receiver default in the companion guide is `030240928` |

### 2.5 Reading the current state in one pass

The closed loop that the POC can exercise is: eligibility over REST, local 837P construction, Payment Accuracy edits, SFTP submit, notification poll, and inbound report parse. Remittance posting, institutional and dental claims, a claim-status screen, and any store that survives a restart are the remaining product work. Demo Coverages is the REST product the vendor has already confirmed; Payment Accuracy and standard claim status still depend on the subscriptions recorded in the Developer Portal.

---

## 3. Environment and portal setup

Two Availity sites provision this integration. Credentials from one do not satisfy the other.

| Site | What you create | Configuration it fills |
|---|---|---|
| Developer Portal, `https://developer.availity.com` | Application, client id, client secret, per-product subscription and scope | `AVAILITY_CLIENT_ID`, `AVAILITY_CLIENT_SECRET`, `AVAILITY_SCOPE`, `AVAILITY_TOKEN_URL` |
| QA Essentials, `https://qa-essentials.availity.com` | QA FTP mailbox, EDI reporting preferences, QA ERA enrollment | `AVAILITY_SFTP_*` with host `qa-files.availity.com` and `AVAILITY_USAGE_INDICATOR=T` |
| Production Essentials, `https://essentials.availity.com` | Production mailbox and production reporting preferences | Host `files.availity.com` and `AVAILITY_USAGE_INDICATOR=P`, plus a Standard-plan API client |

`[FILL IN: which login owns the Developer Portal app, which login owns the Essentials mailbox admin, and the Availity customer id on the contract.]` Support case 18993019 recorded customer id `805925`.

### 3.1 Developer Portal

1. Sign in at `https://developer.availity.com`.
2. Create an application, or open the one already tied to this contract. The app is the OAuth client. Availity displays the client secret once. Store it outside the repository. A lost secret is reset from the app’s Client Secret section; the previous value cannot be recovered.
3. Subscribe the app to a plan.
   - **Demo** is approved automatically. It is the sandbox plan (canned or non-production data). The API Guide dated 10/31/2025 states a limit of 5 transactions per second and 500 per day. Token calls, the initial request, and each eligibility poll all count. Case 18993019 described 3 per second. `[FILL IN: the limit shown on this app.]`
   - **Standard** is the live plan. Trading Partner Management activates it after a support request (Essentials → Help & Training → Availity Support, case reason API) or the portal’s sales contact.
4. On the app’s approved-access list, subscribe each product this design calls: Coverages, the Payment Accuracy edits product, and Claim Statuses if those routes will be used. A plan subscription does not by itself add every product.
5. Copy the scope from each product’s client info. This service sends a single `AVAILITY_SCOPE` on the token request. The published Coverages example uses `hipaa`. When a product page lists two scopes, put them in that variable separated by one space.
6. Copy the token URL from the same page into `AVAILITY_TOKEN_URL`. This repository defaults to `https://api.availity.com/availity/v1/token`, which is the URL in the current API Guide.

`[FILL IN: app name, plan, products under Approved Access, and the scope string for Payment Accuracy.]`

### 3.2 QA Essentials mailbox

1. Sign in at `https://qa-essentials.availity.com`.
2. Open Claims & Payments → FTP and EDI Connection Services → Manage Your FTP Mailbox.
3. Select the organization, choose a mailbox username and password, and create the account. This username is `AVAILITY_SFTP_USERNAME`. It is not the Essentials user id.
4. Mailbox password policy from the companion guide: at least 14 characters with upper, lower, digit, and special character; cannot reuse the last 12 passwords; expires every 12 months; locks after 3 failed logins or 90 days idle.
5. Set EDI reporting preferences before the first test upload. Those preferences choose which response files Availity writes to `/ReceiveFiles` and how they are grouped. `[FILL IN: the preference set for this organization.]`
6. Enroll ERA/835 per payer when remittance files are part of the test. `[FILL IN: payer ids enrolled in QA.]`
7. Assign the EDI Management role to people who upload through the Essentials UI. The SFTP client in this repo authenticates as the mailbox and does not use that role.

| | QA | Production |
|---|---|---|
| Host | `qa-files.availity.com` | `files.availity.com` |
| Port | 22 | 22 |
| Drop 837 files | `/SendFiles` | `/SendFiles` |
| Pick up responses | `/ReceiveFiles` | `/ReceiveFiles` |
| ISA15 | `T` | `P` |
| Browser file UI | `https://qa-files.availity.com` | `https://files.availity.com` |

QA uploads are structurally validated and are not forwarded to the payer. Production Essentials (`https://essentials.availity.com`) is the same mailbox procedure with production credentials and `AVAILITY_USAGE_INDICATOR=P`. Keep QA and production values in separate env files. This process has one configuration.

### 3.3 Environment variables

From `backend/`:

```bash
cp .env.example .env
```

`backend/.env` is gitignored. `main.ts` loads it before the boot guard. A variable already exported in the shell overrides the file. Restart the Nest process after any change. The token and the host pairing are read at startup.

The process will not listen unless these are non-empty: `AVAILITY_CLIENT_ID`, `AVAILITY_CLIENT_SECRET`, `AVAILITY_SFTP_HOST`, `AVAILITY_SFTP_USERNAME`, and exactly one of `AVAILITY_SFTP_PASSWORD` or `AVAILITY_SFTP_PRIVATE_KEY_PATH`. Joi also requires `AVAILITY_SUBMITTER_ID` and `AVAILITY_RECEIVER_ID` outside tests.

| Variable | Value to set | Role |
|---|---|---|
| `AVAILITY_CLIENT_ID` | Developer Portal app | OAuth client id |
| `AVAILITY_CLIENT_SECRET` | Developer Portal app | OAuth secret |
| `AVAILITY_SCOPE` | `hipaa`, or the product’s scope string | Token request |
| `AVAILITY_REALM` | empty unless the product page requires it | Optional token field |
| `AVAILITY_BASE_URL` | `https://api.availity.com` | Prefix for Coverages, claim status, and payment-accuracy |
| `AVAILITY_TOKEN_URL` | `https://api.availity.com/availity/v1/token` | Full token URL. Independent of `AVAILITY_BASE_URL` |
| `AVAILITY_API_VERSION` | `v1` | Stored on the config object. Call paths in the REST service are explicit |
| `AVAILITY_SUBMITTER_ID` | Id assigned by Availity | ISA06, GS02, eligibility `submitterId`, claim-status `submitterId` |
| `AVAILITY_RECEIVER_ID` | `030240928` unless Client Services assigns another | ISA08 |
| `AVAILITY_USAGE_INDICATOR` | `T` in QA, `P` in production | ISA15 |
| `AVAILITY_SFTP_HOST` | `qa-files.availity.com` or `files.availity.com` | Must match the usage indicator |
| `AVAILITY_SFTP_PORT` | `22` | |
| `AVAILITY_SFTP_USERNAME` | Mailbox username | |
| `AVAILITY_SFTP_PASSWORD` | Mailbox password | Leave unset when using a key |
| `AVAILITY_SFTP_PRIVATE_KEY_PATH` | PEM path | Leave unset when using a password |
| `AVAILITY_SFTP_SEND_PATH` | `/SendFiles` | |
| `AVAILITY_SFTP_RECEIVE_PATH` | `/ReceiveFiles` | |
| `AVAILITY_ALLOW_ENV_MISMATCH` | `false` | `true` allows a host and ISA15 pair the guard would refuse |
| `AVAILITY_CONTROL_NUMBER_STORE` | empty, or a file path | Where ISA13 is persisted. Empty uses the service default path |
| `AVAILITY_COVERAGE_POLL_ATTEMPTS` | `15` | Eligibility poll budget |
| `AVAILITY_COVERAGE_POLL_INTERVAL_MS` | `2000` | Pause between coverage polls |
| `PORT` | `3000` | Must be the Vite proxy target |
| `NODE_ENV` | `development` | `test` skips the credential boot guard |
| `LOG_LEVEL` | `debug` | `error`, `warn`, `info`, or `debug` |

`OPTUM_*` variables in the same file configure the other clearinghouse. They do not authenticate Availity calls.

### 3.4 Run

```bash
# Terminal 1 — API
cd backend
npm install
npm run start:dev

# Terminal 2 — dashboard
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` and switch the clearinghouse control to Availity. The shell opens on Optum. Startup logs the listen URL, `AVAILITY_BASE_URL`, and the SFTP host.

A missing credential stops the process with `Availity configuration missing` and the names of the empty variables. The boot log line `Obtained Availity access token` means the Developer Portal client id, secret, token URL, and scope were accepted.
