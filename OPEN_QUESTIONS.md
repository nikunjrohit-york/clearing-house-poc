# Open questions for Availity Client Services

The EDI companion guide file is not in this repository. These items are marked `UNCONFIRMED` in code until Availity answers them. The POC fails closed instead of guessing.

1. Please confirm the OAuth token URL. This POC calls `https://api.availity.com/availity/v1/token` because that path responds. The integration notes also show `https://api.availity.com/v1/token`. Which one is current for our contract?
2. Please confirm the Coverages path. This POC uses `POST /availity/v1/coverages` and `GET /availity/v1/coverages/{id}`. The notes also show `/v1/coverages`. Are both accepted?
3. What is the exact column layout of pipe-delimited `.ibr`, `.ibrp`, `.ebr`, and `.dpr` rows, including from/to dates, clearinghouse trace number, payer claim number, Availity trace number, and version?
4. Notification files are matched as `<original>-success`, `<original>-FAILED`, and `<original>-<digits>-success` / `-FAILED`. Is the batch id always `YYYYMMDDHHMMSSSS`, and are `_-success` / `_success` still produced by any mailbox?
5. Which payer IDs should be treated as Medicare for the "no subscriber SSN" edit?
6. Which procedure codes require the oxygen CR5/CR501 and 2420E PER/DTP segments, and which require home-health CR6? The POC rejects claims that set `oxygenTherapy` or `homeHealth` until that map is confirmed.
7. Is 277IBR / 277EBR enrollment per payer, or is it an organization reporting preference?
8. Are production REST API keys required if claim submission and ERA retrieval stay on SFTP, or is the Demo key enough for eligibility and standard claim status?
9. What are the exact steps for an administrator to provision the QA SFTP mailbox if the integration user does not have the EDI Management role?
10. ISA09/ISA10 time zone is not stated separately from GS05 (GMT). The envelope uses UTC for both. Should ISA time stay in Eastern Time instead?
11. Demo rate limits are described as 3 transactions per second and 500 per day. Should the client throttle, or does Availity return a specific status the POC should wait on?
