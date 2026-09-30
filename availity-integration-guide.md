# Availity Clearinghouse Integration — Guide & Gap Analysis for Delphi

Based on: Availity support case **18993019** (closed 9/25/2026), the **Batch EDI Standard Companion Guide v.20260429**, and current Availity Developer Portal documentation.

---

## 1. What actually happened in the ticket

Delphi tried to reach claim submission, claim status, and remittance through **REST API endpoints** using a **Demo API key**. Availity's response (Cortney Lawson, 9/25) clarifies each one:

| What was tried | Why it 404'd | What actually works |
|---|---|---|
| `POST /availity/v1/professional-claims` | This is the **Patient Cost Estimator (PCE)** endpoint, not 837 claim submission | Claims are **not submitted via this REST endpoint at all** — see §2 |
| `POST /availity/claims` | Not a real Availity path | — |
| SFTP `sftp.availity.com:22` | Wrong host — Availity migrated to a new **managed file transfer (MFT)** platform | `files.availity.com` (prod) / `qa-files.availity.com` (QA), port 22, SFTP |
| `.../clmsmgmt/claim-status/.../searchBy276` | This is **Enhanced Claim Status**, a paid add-on **not available in Demo** | Standard Claim Status: `POST /v1/claim-statuses`, `GET /v1/claim-statuses/{id}` |
| `POST /v2/Apic/searchChecks`, `/remittance-data-api/v1/checks/search` | Availity's **Remittance Data API is in closed BETA**, not in prod or Demo, no ETA | ERA/835 files delivered only through **Batch EDI (SFTP)** once enrolled |

**Bottom line from Availity:** only Eligibility (Coverages 270/271) is confirmed working on the Demo key. Everything else Delphi needs — claim submission, claim status, and remittance — is **not exposed as REST in Demo/current contract** and routes through **Batch EDI over SFTP** instead.

---

## 2. The two integration paths — and which one Delphi needs

Availity offers two separate, non-overlapping product families. They are **not different ways to do the same thing** — they cover different transaction sets.

| | **Batch EDI (SFTP)** | **Healthcare HIPAA Transactions REST APIs** |
|---|---|---|
| Claim submission (837P/I/D) | ✅ Yes — this is the only way | ❌ Not available (no REST 837 submission product) |
| Remittance / ERA (835) | ✅ Yes, once enrolled per payer | ❌ Remittance Data API is BETA, not usable |
| Claim status (276/277) | ✅ Via batch, or... | ✅ Standard Claim Statuses API (real-time, per-claim) |
| Eligibility (270/271) | Possible but usually not worth batching | ✅ Coverages API — **this is what's already working** |
| Auth/referral (278) | ✅ Via batch | ✅ Service Reviews API |
| Volume model | Bulk files, near-real-time turnaround | Real-time, one call per request |
| Auth | SFTP username/password | OAuth 2.0 client-credentials (bearer token) |

**Conclusion:** For Delphi's PR-first allocation + payment waterfall engine, the core dependency — **submitting claims and receiving remittances** — has to be built on **Batch EDI / SFTP**, not REST. The REST APIs are a good fit only for two things Delphi doesn't currently need in bulk: real-time eligibility checks (already working) and real-time single-claim status lookups.

---

## 3. Batch EDI / SFTP — full integration guide

### 3.1 Account setup (do this first)

1. **Organization registration** — done already (Delphi is Customer ID 805925). Skip.
2. **Create a QA EDI account** (separate from your Essentials login):
   - Log in to `https://qa-essentials.availity.com`
   - `Claims & Payments → FTP and EDI Connection Services → Manage Your FTP Mailbox`
   - Select org → set a username/password → Create Account
3. **Create a Production EDI account** the same way at `https://essentials.availity.com`.
4. **Password policy** (both environments): min 14 chars, needs upper/lower/number/special char, can't reuse last 12, expires every 12 months, account locks after 3 failed logins or 90 days idle.
5. **Configure EDI Reporting Preferences** — this decides which response files you actually receive (ACK, 999, IBR/IBRP, EBR, DPR, 277CA, ERA/835) and how they're grouped (by org, by provider, by payer). Do this before you start testing — if it's not turned on here, the file never lands in `ReceiveFiles`.
6. **Enroll for ERA/835 delivery** per payer, via the Availity payer list — this is separate from claim submission enrollment. If ERAs are already flowing to Availity from a payer today, skip.
7. Assign the **EDI Management** role to whichever Delphi users/service accounts need to push files through Essentials (not needed for the SFTP client path).

### 3.2 Connection details

| Field | QA | Production |
|---|---|---|
| Host | `qa-files.availity.com` | `files.availity.com` |
| Port | 22 (SFTP) | 22 (SFTP) |
| Auth | username/password (Normal login) | username/password |
| Browser alternative | `https://qa-files.availity.com` | `https://files.availity.com` |

Folders: **`SendFiles`** (you drop 837/276/270/278/275 files here) and **`ReceiveFiles`** (Availity drops all response/report/ERA files here).

### 3.3 Integration testing (do this before touching production)

- Coordinated free-of-charge through Availity Client Services — you need them to provision your QA login.
- Test in QA using `ISA15 = T` (test indicator). Test files auto-reject after passing structural validation — they never reach the payer.
- **Do not** test in production with `ISA15 = P` unless you mean it — Availity forwards it to the payer regardless of the indicator; `ISA15=T` in prod only prevents payer routing, it still isn't a safe default for real testing.
- Same upload/download/reporting-preferences mechanics apply in both environments.

### 3.4 Submitting a batch (837 claim file)

1. Build the X12 837 file (837P `005010X222A1` for professional, 837I `005010X223A2` institutional).
2. Drop it into `SendFiles` (SFTP client or `https://files.availity.com` web upload — max 5 files/upload, 150 MB/file via web).
3. Availity returns a **notification file** to `SendFiles`: `<original-filename>-<AvailityBatchID>-success` or `-FAILED`.
   - Batch ID format: `YYYYMMDDHHMMSSSS` — this is the ID you give Availity Client Services for any support case.
   - Notification files are purged nightly from `SendFiles` whether downloaded or not — **poll and archive them same-day**.
4. If `-FAILED`: reasons are empty file, wrong file type (must be `.txt`), or first 3 bytes ≠ `ISA`. Rebatch with a **new interchange control number** and resubmit.

### 3.5 Response files — what comes back, and in what order

| Stage | File | What it tells you | Typical timing |
|---|---|---|---|
| 1. File-level | Notification (`-success`/`-FAILED`) | Did Availity even recognize the file | Seconds–minutes |
| 2. File-level | `.ACK` | Proprietary format validation failed (usually malformed X12) | Minutes |
| 3. Envelope-level | `.TA1` | ISA/IEA/GS envelope errors (dup control number, bad trading partner) | Minutes |
| 4. Syntax-level | `.999` | Accept/reject per ST/SE transaction set (X12 syntax) | Minutes |
| 5. Claim-level (fast) | `.ibr` / `.ibrp` / `.277IBR` | Per-claim accept/reject — HIPAA, payer-specific, or clinical edits | Minutes, up to 24h |
| 6. Claim-level (payer) | `.ebr` / `.277EBR` | Aggregated payer/trading-partner status | 24–48h |
| 7. Claim-level (late) | `.dpr` | Late-arriving payer status (not all payers) | Up to 30 days |
| 8. Payment | `.era` (835) | Remittance — this is what feeds Delphi's payment waterfall | Per payer's own cycle |

All of these land in `ReceiveFiles` (except the notification, which stays in `SendFiles`). **Response files are purged after 30 days** (self-restorable for 6 months; Availity Client Services can pull older ones on request).

**IBR/EBR are available as pipe-delimited data files** (`.ibr`/`.ebr`, machine-parseable) **or as an X12 277CA** (`.277ibr`/`.277ebr`, if you'd rather parse standard X12 than Availity's pipe format) **or as human-readable text** (`.ibt`/`.ebt`). For a NestJS parser, pull the pipe-delimited format — it's flatter to map to Prisma rows than re-parsing X12.

### 3.6 ISA/GS envelope requirements (what your 837 generator must emit)

Fixed values Availity requires (deviating from these causes TA1/ACK rejects):

| Segment | Field | Required value |
|---|---|---|
| ISA01/02 | Authorization Info Qualifier/Info | `00` / 10 blanks |
| ISA03/04 | Security Info Qualifier/Info | `00` / 10 blanks |
| ISA05 | Interchange ID Qualifier | `ZZ` |
| ISA06 | Interchange Sender ID | Your Availity-assigned trading partner ID |
| ISA07 | Interchange ID Qualifier (receiver) | `01` |
| ISA08 | Interchange Receiver ID | `030240928` (+6 spaces) — Availity's D&B number |
| ISA11 | Repetition Separator | `^` |
| ISA12 | Version | `00501` |
| ISA15 | Usage Indicator | `T` (test) / `P` (production) |
| ISA16 | Component Element Separator | any Basic Character Set value |
| Delimiters | element `*`, sub-element `:`, terminator `~`, repetition `^` | Don't reuse these inside data |
| GS06 | Group Control Number | Unique per interchange, recommended unique for 6 months |
| ST02 | Transaction Set Control Number | Sequential starting at 1 within each GS |

Optimal batch size: **5,000 claims or 4 MB** per 837 file (12 MB soft ceiling on 835 processing — large-check 835s over 12 MB may not validate).

### 3.7 Practical gotchas from Availity's own tips (worth codifying as validation rules before you ever batch)

- No decimals in procedure/diagnosis codes (`52525`, not `525.25`).
- No decimals in whole-dollar amounts (`27`, not `27.00`); round to 2 decimals max on cents (`59.99`, not `59.99223`).
- Dates: `YYYYMMDD`, and every date on the claim (service date, onset, last-seen, etc.) must be **before** the transaction creation date.
- No dashes in ZIP codes (dashes in SSN/tax ID/employer ID are stripped automatically, so harmless but pointless).
- No colons or asterisks in free-text fields — they collide with X12 delimiters.
- Max 50 service lines per claim.
- Rebatched files need a **new** interchange control number or they're rejected as duplicates.
- No cutoff time on Availity's side — but **payers** have their own daily cutoffs; ask each payer directly if same-day cycle matters.

### 3.8 Operational reference

- **System status:** `https://payernetworkstatus.availity.com/`
- **Maintenance windows (ET):** code changes Wed 9–11pm; infra Wed 11pm–Thu 1am; misc Sun 12–8am
- **Support:** 800-282-4548, business hours by timezone; **always have the Availity Batch ID ready**

---

## 4. REST APIs — what's real, current, and usable today

All REST calls need an **OAuth 2.0 client-credentials token** first (separate from your SFTP creds):

```bash
curl -i -X POST "https://api.availity.com/v1/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&scope=$SCOPE&client_id=$API_KEY&client_secret=$CLIENT_SECRET"
```

Token is valid **5 minutes** — cache and refresh per-call in the service layer, don't try to hold it across requests.

### 4.1 Coverages (270/271) — already confirmed working

```
POST /v1/coverages          # submit + search recent requests
GET  /v1/coverages/{id}     # poll / retrieve full detail
DELETE /v1/coverages/{id}
```

Asynchronous pattern used across every one of these HIPAA REST APIs:
1. `POST` → get back `statusCode` (`0` = In Progress, `4`/`3` = Complete) and an `id`.
2. If `0`, poll `GET /v1/coverages/{id}` every ~2 seconds until status flips.
3. Availity caches responses locally until `expirationDate` — repeat requests inside that window return the cached copy instead of re-querying the payer.

### 4.2 Claim Statuses (standard, 276/277) — this is the right replacement for the 404'd endpoint

```
POST /v1/claim-statuses
GET  /v1/claim-statuses/{id}
```

Same async poll pattern as Coverages. This is different from **Enhanced Claim Status** (`.../clmsmgmt/claim-status/.../searchBy276`), which is a paid add-on product, **not available on a Demo key**, and wasn't what Delphi should have been calling. If Delphi only needs go/no-go claim status (not the richer value-add 277 data Enhanced Claim Status returns), standard Claim Statuses is sufficient and simpler.

### 4.3 Configurations — use this before building any payer-specific request

```
GET /v1/configurations?type=270&payerId=<id>
GET /v1/configurations?type=claim-statuses-inquiry&payerId=<id>
```

Returns the field-level validation rules (required fields, patterns, max lengths) **per payer**, because payers don't all require the same fields. Worth calling once per payer and caching the ruleset rather than hardcoding validation.

### 4.4 Availity Payer List (REST)

```
GET /v1/availity-payer-list?payerId=&transactionType=&submissionMode=&availability=
```

Lets you programmatically check, per payer, whether a transaction is `available` (free) vs `contract required` (fee-based), and whether it's supported via `Portal`, `Batch`, `RealTime`, or `API`. Good candidate to sync into a Delphi payer-config table so allocation logic knows which channel a given payer actually supports.

### 4.5 Not usable right now

- **Remittance Data API** — closed BETA per Availity's blog listing, no prod/Demo access, no ETA. Don't build against it.
- **Enhanced Claim Status** — paid add-on, not in Demo.
- **837 claim submission via REST** — doesn't exist as a product; `professional-claims`/`institutional-claims` REST paths are Patient Cost Estimator (predetermination), not claim submission.

---

## 5. Gap summary — what to fix in Delphi's plan

| Gap | Fix |
|---|---|
| Assumed REST covered claim submission | Build the 837 generator/submitter against **SFTP Batch EDI**, not REST |
| Wrong SFTP host (`sftp.availity.com`) | Use `files.availity.com` / `qa-files.availity.com`, port 22 |
| Called Enhanced Claim Status, not entitled to it in Demo | Use standard `POST /v1/claim-statuses` for REST-based status checks |
| Assumed a Remittance REST API | ERA/835 only arrives via Batch EDI `ReceiveFiles`, after per-payer ERA enrollment |
| No production API key provisioned | Contact Availity Client Services / your account rep to confirm the org's actual contract tier and get production credentials issued (separate from the Demo key you tested with) |
| No webhook for new files | None exists — Availity confirmed no webhook option in the guide. Plan on **polling** `ReceiveFiles` on an interval (or after each `SendFiles` submission) rather than push notifications |

---

## 6. Suggested POC scope for Delphi (NestJS/Prisma)

Given the payment waterfall and PR-first allocation engine both key off remittance data, the POC should prove the **full closed loop**, not just "can we log in":

1. **SFTP service module** — wraps an SFTP client (`ssh2-sftp-client` or similar) pointed at QA (`qa-files.availity.com`), with `SendFiles`/`ReceiveFiles` polling.
2. **837P generator** — build one real test claim (test ISA15=T) from existing Delphi claim data → drop in `SendFiles`.
3. **Response poller** — cron/queue job that lists `ReceiveFiles`, pulls new files, and routes by extension: `.ACK`/`.TA1`/`.999` → file/envelope error table; `.ibr` (pipe-delimited) → claim-level accept/reject table, matched back to the Delphi claim by `CLM01`/patient control number.
4. **ERA ingestion** — once ERA enrollment is confirmed for at least one test payer, parse an `.era` (835) file into the existing payment-bifurcation / waterfall pipeline as a new ingestion source, alongside however remits are entered today.
5. **Reconciliation view** — Batch ID → claims sent → responses received → ERA applied, so Delphi engineers can see the whole lifecycle of one test batch without digging through raw files.

**Sequencing:** get step 1–3 working end-to-end in QA first (this validates connectivity and response parsing without needing real payer money movement), then tackle ERA enrollment + step 4 in parallel with Availity Client Services, since ERA enrollment is a per-payer process with its own lead time.

---

## 7. Questions to put back to Availity Client Services

1. What is Delphi's actual current contract/plan tier, and which transactions on the payer list are `available` vs `contract required` for us specifically?
2. Can they issue **production** SFTP credentials and, separately, a **production** REST API key/secret (the Demo key is rate-limited to 3 tps / 500 per day)?
3. Which payers does Delphi bill most often, and are we already ERA-enrolled with any of them, or does that need to be initiated per payer?
4. Confirm whether standard `POST /v1/claim-statuses` is included in our current contract, or whether it also requires a separate subscription.
