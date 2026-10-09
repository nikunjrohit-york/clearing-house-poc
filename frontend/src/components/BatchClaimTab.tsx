import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { Badge, ErrorAlert, Field, FillSelect, Spinner, inputClass } from './ui';

interface ServiceLineForm {
  procedureCode: string;
  amount: string;
  serviceDate: string;
  quantity: string;
}

interface ClaimEdit {
  severity?: string;
  ruleCode?: string;
  description?: string;
  message?: string;
  lineNumber?: number | string;
}

interface ClaimValidation {
  valid: boolean;
  triggeredResult: ClaimEdit[];
  transactionIdentifier?: string;
  x12Payload: string;
}

interface PostalForm {
  address1: string;
  city: string;
  state: string;
  zip: string;
}

interface BatchForm {
  payerId: string;
  claimControlNumber: string;
  frequencyCode: string;
  diagnosisCode: string;
  subscriberFirstName: string;
  subscriberLastName: string;
  memberId: string;
  birthDate: string;
  gender: string;
  subscriberAddress: PostalForm;
  billingName: string;
  billingNpi: string;
  billingTaxId: string;
  billingAddress: PostalForm;
  placeOfService: string;
  lines: ServiceLineForm[];
}

interface UploadResult {
  fileName: string;
  remotePath: string;
  byteSize: number;
  claimControlNumber: string;
  interchangeControlNumber: string;
}

interface NotificationStatus {
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  errorDetails?: string;
  fileName: string;
  notificationFile?: string;
}

const emptyLine = (): ServiceLineForm => ({
  procedureCode: '',
  amount: '',
  serviceDate: '',
  quantity: '1',
});

const emptyAddress = (): PostalForm => ({ address1: '', city: '', state: '', zip: '' });

const emptyForm: BatchForm = {
  payerId: '',
  claimControlNumber: '',
  frequencyCode: '1',
  diagnosisCode: '',
  subscriberFirstName: '',
  subscriberLastName: '',
  memberId: '',
  birthDate: '',
  gender: 'M',
  subscriberAddress: emptyAddress(),
  billingName: '',
  billingNpi: '',
  billingTaxId: '',
  billingAddress: emptyAddress(),
  placeOfService: '11',
  lines: [emptyLine()],
};

const officeVisit: BatchForm = {
  payerId: '00001',
  claimControlNumber: 'CLM123456',
  frequencyCode: '1',
  diagnosisCode: 'I10',
  subscriberFirstName: 'John',
  subscriberLastName: 'Doe',
  memberId: 'MEM123456',
  birthDate: '1980-01-01',
  gender: 'M',
  subscriberAddress: { address1: '200 Elm St', city: 'Concord', state: 'NH', zip: '03301' },
  billingName: 'The Delphi Group LLC',
  billingNpi: '1194476978',
  billingTaxId: '27-2499372',
  billingAddress: { address1: '100 Main St', city: 'Concord', state: 'NH', zip: '03301' },
  placeOfService: '11',
  lines: [{ procedureCode: '99213', amount: '100.00', serviceDate: '2026-03-01', quantity: '1' }],
};

const fillOptions = [{ id: 'qa-claim', label: 'Autofill QA Claim', value: officeVisit }];

const VALIDATION_403_WARNING =
  'REST Pre-validation unavailable (403 Forbidden). You can still proceed with direct SFTP submission.';

function isValidationForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

function lineCharge(line: ServiceLineForm): number {
  const quantity = Number(line.quantity);
  const amount = Number(line.amount);
  if (!Number.isFinite(quantity) || !Number.isFinite(amount)) {
    return 0;
  }
  return Math.round(quantity * amount * 100) / 100;
}

export default function BatchClaimTab() {
  const [form, setForm] = useState<BatchForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState('');
  const [edits, setEdits] = useState<ClaimValidation | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [notice, setNotice] = useState<NotificationStatus | null>(null);
  const [polling, setPolling] = useState(false);
  const [skipValidation, setSkipValidation] = useState(false);
  const [validationWarning, setValidationWarning] = useState('');

  const totalCharge = useMemo(() => form.lines.reduce((sum, line) => sum + lineCharge(line), 0), [form.lines]);
  const terminal = notice?.status === 'SUCCESS' || notice?.status === 'FAILED';

  useEffect(() => {
    if (!upload?.fileName || terminal) {
      return undefined;
    }

    let cancelled = false;

    async function checkStatus() {
      try {
        const status = await api<NotificationStatus>(`/api/availity/claims/batch-status/${encodeURIComponent(upload.fileName)}`);
        if (!cancelled) {
          setNotice(status);
          setPolling(status.status === 'PENDING');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Status check failed');
          setPolling(false);
        }
      }
    }

    setPolling(true);
    void checkStatus();
    const timer = window.setInterval(() => {
      void checkStatus();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [upload?.fileName, terminal]);

  function localProblems(): string | null {
    const diagnosis = form.diagnosisCode.trim();
    if (!diagnosis) {
      return 'Primary diagnosis is required';
    }
    if (!/^(?![Ee])/.test(diagnosis)) {
      return 'Primary diagnosis cannot start with E';
    }
    const frequencyCode = form.frequencyCode || '1';
    if (!/^[1-8]$/.test(frequencyCode)) {
      return 'Frequency code must be 1 through 8';
    }
    if (!(form.placeOfService || '11').trim()) {
      return 'Place of service is required';
    }
    if (!form.billingName.trim()) {
      return 'Billing provider organization name is required';
    }
    return null;
  }

  function claimBody() {
    const organizationName = form.billingName.trim();
    const frequencyCode = form.frequencyCode || '1';
    const placeOfService = form.placeOfService || '11';
    return {
      claimType: 'professional',
      tradingPartnerId: form.payerId.trim(),
      claimControlNumber: form.claimControlNumber.trim(),
      frequencyCode,
      placeOfService,
      billingProvider: {
        name: organizationName,
        organizationName,
        npi: form.billingNpi.trim(),
        taxId: form.billingTaxId.trim(),
        address: {
          address1: form.billingAddress.address1.trim(),
          city: form.billingAddress.city.trim(),
          state: form.billingAddress.state.trim(),
          zip: form.billingAddress.zip.trim(),
        },
      },
      subscriber: {
        firstName: form.subscriberFirstName.trim(),
        lastName: form.subscriberLastName.trim(),
        memberId: form.memberId.trim(),
        birthDate: form.birthDate,
        gender: form.gender,
        address: {
          address1: form.subscriberAddress.address1.trim(),
          city: form.subscriberAddress.city.trim(),
          state: form.subscriberAddress.state.trim(),
          zip: form.subscriberAddress.zip.trim(),
        },
      },
      diagnoses: [{ code: form.diagnosisCode.trim() }],
      serviceLines: form.lines.map((line, index) => ({
        lineNumber: index + 1,
        procedureCode: line.procedureCode.trim(),
        quantity: Number(line.quantity),
        unitPrice: Number(line.amount),
        serviceDate: line.serviceDate,
        placeOfService,
        diagnosisPointer: '1',
      })),
      totalCharge,
    };
  }

  async function runValidation(): Promise<ClaimValidation> {
    return api<ClaimValidation>('/api/availity/claims/validate', {
      method: 'POST',
      body: JSON.stringify(claimBody()),
    });
  }

  async function submitBatch(): Promise<UploadResult> {
    return api<UploadResult>('/api/availity/claims/batch-submit', {
      method: 'POST',
      body: JSON.stringify(claimBody()),
    });
  }

  function updateLine(index: number, field: keyof ServiceLineForm, value: string) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, [field]: value } : line)),
    }));
  }

  async function onValidate() {
    const problem = localProblems();
    if (problem) {
      setError(problem);
      setEdits(null);
      return;
    }
    setValidating(true);
    setError('');
    setEdits(null);
    setValidationWarning('');
    try {
      setEdits(await runValidation());
    } catch (err) {
      if (isValidationForbidden(err)) {
        setValidationWarning(VALIDATION_403_WARNING);
        return;
      }
      setError(err instanceof Error ? err.message : 'Claim validation failed');
    } finally {
      setValidating(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = localProblems();
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError('');
    setUpload(null);
    setNotice(null);
    if (!skipValidation) {
      setEdits(null);
      setValidationWarning('');
    }
    try {
      if (!skipValidation) {
        try {
          const validation = await runValidation();
          setEdits(validation);
          const blocking = validation.triggeredResult.filter((edit) => edit.severity?.trim().toLowerCase() === 'error');
          if (blocking.length > 0) {
            setError('Availity returned claim edits with severity Error. The batch was not uploaded.');
            return;
          }
        } catch (err) {
          if (!isValidationForbidden(err)) {
            throw err;
          }
          setValidationWarning(VALIDATION_403_WARNING);
          setEdits(null);
        }
      }
      setUpload(await submitBatch());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Batch 837P claim</h2>
          <p className="mt-1 text-sm text-slate-500">
            Builds a professional claim and uploads BATCH_&lt;ICN&gt;.txt to /SendFiles/. Availity posts a -success or -FAILED file in that same folder. There is no webhook.
          </p>
        </div>

        <FillSelect options={fillOptions} onFill={setForm} onClear={() => setForm(emptyForm)} />

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Payer ID">
            <input className={inputClass} required value={form.payerId} onChange={(event) => setForm({ ...form, payerId: event.target.value })} />
          </Field>
          <Field label="Patient control number">
            <input
              className={inputClass}
              required
              value={form.claimControlNumber}
              onChange={(event) => setForm({ ...form, claimControlNumber: event.target.value })}
            />
          </Field>
          <Field label="Frequency code">
            <select className={inputClass} value={form.frequencyCode} onChange={(event) => setForm({ ...form, frequencyCode: event.target.value })}>
              <option value="1">1 — Original</option>
              <option value="2">2 — Interim</option>
              <option value="3">3 — Final</option>
              <option value="4">4 — Void</option>
              <option value="5">5 — Replacement</option>
              <option value="6">6 — Corrected</option>
              <option value="7">7 — Replacement of prior</option>
              <option value="8">8 — Void of prior</option>
            </select>
          </Field>
          <Field label="Place of service">
            <select className={inputClass} value={form.placeOfService} onChange={(event) => setForm({ ...form, placeOfService: event.target.value })}>
              <option value="11">11 — Office</option>
              <option value="12">12 — Home</option>
              <option value="20">20 — Urgent care</option>
              <option value="21">21 — Inpatient hospital</option>
              <option value="22">22 — Outpatient hospital</option>
              <option value="23">23 — Emergency room</option>
            </select>
          </Field>
          <Field label="Diagnosis (ICD-10)">
            <input
              className={inputClass}
              required
              value={form.diagnosisCode}
              onChange={(event) => setForm({ ...form, diagnosisCode: event.target.value })}
            />
          </Field>
        </div>

        <fieldset className="grid gap-4 md:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold text-slate-800">Subscriber</legend>
          <Field label="First name">
            <input
              className={inputClass}
              required
              value={form.subscriberFirstName}
              onChange={(event) => setForm({ ...form, subscriberFirstName: event.target.value })}
            />
          </Field>
          <Field label="Last name">
            <input
              className={inputClass}
              required
              value={form.subscriberLastName}
              onChange={(event) => setForm({ ...form, subscriberLastName: event.target.value })}
            />
          </Field>
          <Field label="Member ID">
            <input className={inputClass} required value={form.memberId} onChange={(event) => setForm({ ...form, memberId: event.target.value })} />
          </Field>
          <Field label="Date of birth">
            <input
              className={inputClass}
              type="date"
              required
              value={form.birthDate}
              onChange={(event) => setForm({ ...form, birthDate: event.target.value })}
            />
          </Field>
          <Field label="Gender">
            <select className={inputClass} value={form.gender} onChange={(event) => setForm({ ...form, gender: event.target.value })}>
              <option value="M">M</option>
              <option value="F">F</option>
            </select>
          </Field>
          <Field label="Address">
            <input
              className={inputClass}
              required
              value={form.subscriberAddress.address1}
              onChange={(event) => setForm({ ...form, subscriberAddress: { ...form.subscriberAddress, address1: event.target.value } })}
            />
          </Field>
          <Field label="City">
            <input
              className={inputClass}
              required
              value={form.subscriberAddress.city}
              onChange={(event) => setForm({ ...form, subscriberAddress: { ...form.subscriberAddress, city: event.target.value } })}
            />
          </Field>
          <Field label="State">
            <input
              className={inputClass}
              required
              maxLength={2}
              value={form.subscriberAddress.state}
              onChange={(event) => setForm({ ...form, subscriberAddress: { ...form.subscriberAddress, state: event.target.value } })}
            />
          </Field>
          <Field label="ZIP">
            <input
              className={inputClass}
              required
              value={form.subscriberAddress.zip}
              onChange={(event) => setForm({ ...form, subscriberAddress: { ...form.subscriberAddress, zip: event.target.value } })}
            />
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 md:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold text-slate-800">Billing provider</legend>
          <Field label="Organization name">
            <input className={inputClass} value={form.billingName} onChange={(event) => setForm({ ...form, billingName: event.target.value })} />
          </Field>
          <Field label="NPI">
            <input
              className={inputClass}
              required
              inputMode="numeric"
              value={form.billingNpi}
              onChange={(event) => setForm({ ...form, billingNpi: event.target.value })}
            />
          </Field>
          <Field label="Tax ID">
            <input className={inputClass} required value={form.billingTaxId} onChange={(event) => setForm({ ...form, billingTaxId: event.target.value })} />
          </Field>
          <Field label="Address">
            <input
              className={inputClass}
              required
              value={form.billingAddress.address1}
              onChange={(event) => setForm({ ...form, billingAddress: { ...form.billingAddress, address1: event.target.value } })}
            />
          </Field>
          <Field label="City">
            <input
              className={inputClass}
              required
              value={form.billingAddress.city}
              onChange={(event) => setForm({ ...form, billingAddress: { ...form.billingAddress, city: event.target.value } })}
            />
          </Field>
          <Field label="State">
            <input
              className={inputClass}
              required
              maxLength={2}
              value={form.billingAddress.state}
              onChange={(event) => setForm({ ...form, billingAddress: { ...form.billingAddress, state: event.target.value } })}
            />
          </Field>
          <Field label="ZIP">
            <input
              className={inputClass}
              required
              value={form.billingAddress.zip}
              onChange={(event) => setForm({ ...form, billingAddress: { ...form.billingAddress, zip: event.target.value } })}
            />
          </Field>
        </fieldset>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Service lines</h3>
            <button
              type="button"
              className="text-sm font-medium text-availity-600 hover:text-availity-700"
              onClick={() => setForm({ ...form, lines: [...form.lines, emptyLine()] })}
            >
              Add line
            </button>
          </div>
          {form.lines.map((line, index) => (
            <div key={index} className="grid gap-3 rounded-xl border border-slate-200 p-3 md:grid-cols-[1fr_1fr_1fr_90px_auto]">
              <Field label="CPT / HCPCS">
                <input className={inputClass} required value={line.procedureCode} onChange={(event) => updateLine(index, 'procedureCode', event.target.value)} />
              </Field>
              <Field label="Amount">
                <input className={inputClass} required inputMode="decimal" value={line.amount} onChange={(event) => updateLine(index, 'amount', event.target.value)} />
              </Field>
              <Field label="Date">
                <input className={inputClass} required type="date" value={line.serviceDate} onChange={(event) => updateLine(index, 'serviceDate', event.target.value)} />
              </Field>
              <Field label="Qty">
                <input className={inputClass} required inputMode="numeric" value={line.quantity} onChange={(event) => updateLine(index, 'quantity', event.target.value)} />
              </Field>
              <div className="flex items-end">
                <button
                  type="button"
                  className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                  disabled={form.lines.length === 1}
                  onClick={() => setForm({ ...form, lines: form.lines.filter((_, lineIndex) => lineIndex !== index) })}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <p className="text-sm text-slate-600">
            Claim total <span className="font-semibold text-slate-900">${totalCharge.toFixed(2)}</span>
          </p>
        </div>

        {validationWarning ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            {validationWarning}
          </div>
        ) : null}

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={skipValidation}
            onChange={(event) => setSkipValidation(event.target.checked)}
          />
          <span>Submit Directly via SFTP (Skip Pre-Validation)</span>
        </label>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={validating || submitting}
            onClick={() => void onValidate()}
            className="inline-flex items-center justify-center rounded-lg border border-availity-500 px-4 py-2 text-sm font-semibold text-availity-700 hover:bg-availity-50 disabled:opacity-60"
          >
            {validating ? <Spinner label="Validating claim..." /> : 'Validate Claim (Dry Run)'}
          </button>
          <button
            type="submit"
            disabled={submitting || validating}
            className="inline-flex items-center justify-center rounded-lg bg-availity-500 px-4 py-2 text-sm font-semibold text-white hover:bg-availity-600 disabled:opacity-60"
          >
            {submitting ? <Spinner label="Uploading batch..." /> : skipValidation ? 'Submit directly via SFTP' : 'Submit batch claim'}
          </button>
        </div>
        {error ? <ErrorAlert message={error} /> : null}
      </form>

      {edits ? <ClaimEdits validation={edits} /> : null}

      {upload ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Upload receipt</h2>
              <p className="mt-1 text-sm text-slate-500">
                {upload.fileName} · {upload.remotePath} · {upload.byteSize} bytes · ICN {upload.interchangeControlNumber}
              </p>
            </div>
            <StatusBadge notice={notice} polling={polling} />
          </div>
          {polling ? (
            <div className="mt-4">
              <Spinner label="Polling /SendFiles/ for -success or -FAILED..." />
            </div>
          ) : null}
          {notice?.status === 'FAILED' ? (
            <div className="mt-4">
              <ErrorAlert message={notice.errorDetails || 'Availity rejected the batch file.'} />
            </div>
          ) : null}
          {notice?.status === 'SUCCESS' ? (
            <p className="mt-4 text-sm text-emerald-700">
              Availity posted {notice.notificationFile || `${upload.fileName}-success`}.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function ClaimEdits({ validation }: { validation: ClaimValidation }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Claim validation</h2>
        <Badge tone={validation.valid ? 'green' : 'amber'}>{validation.valid ? 'No edits' : `${validation.triggeredResult.length} edit(s)`}</Badge>
      </div>
      {validation.transactionIdentifier ? (
        <p className="mt-2 text-sm text-slate-500">Transaction {validation.transactionIdentifier}</p>
      ) : null}
      {validation.triggeredResult.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">Availity returned an empty triggeredResult. This claim can be uploaded.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {validation.triggeredResult.map((edit, index) => (
            <li key={`${edit.ruleCode || 'edit'}-${edit.lineNumber || index}`} className="space-y-1 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={edit.severity?.trim().toLowerCase() === 'error' ? 'red' : edit.severity?.trim().toLowerCase() === 'warning' ? 'amber' : 'slate'}>
                  {edit.severity || 'Edit'}
                </Badge>
                {edit.ruleCode ? <span className="font-medium text-slate-900">{edit.ruleCode}</span> : null}
                {edit.lineNumber !== undefined && edit.lineNumber !== '' ? (
                  <span className="text-slate-500">Line {edit.lineNumber}</span>
                ) : null}
              </div>
              <p className="text-slate-700">{edit.description || edit.message || 'Availity did not include an edit description.'}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusBadge({ notice, polling }: { notice: NotificationStatus | null; polling: boolean }) {
  if (!notice) {
    return null;
  }
  if (notice.status === 'PENDING' && polling) {
    return <Badge tone="amber">Pending</Badge>;
  }
  if (notice.status === 'SUCCESS') {
    return <Badge tone="green">Success</Badge>;
  }
  if (notice.status === 'FAILED') {
    return <Badge tone="red">Failed</Badge>;
  }
  return <Badge tone="amber">Pending</Badge>;
}
