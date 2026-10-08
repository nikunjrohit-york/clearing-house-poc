import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Badge, ErrorAlert, Field, Spinner, inputClass } from './ui';

interface ServiceLineForm {
  procedureCode: string;
  amount: string;
  serviceDate: string;
  quantity: string;
}

interface BatchForm {
  payerId: string;
  claimControlNumber: string;
  diagnosisCode: string;
  subscriberFirstName: string;
  subscriberLastName: string;
  memberId: string;
  dateOfBirth: string;
  gender: string;
  billingName: string;
  billingNpi: string;
  billingTaxId: string;
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
  procedureCode: '99213',
  amount: '150.00',
  serviceDate: '2026-09-10',
  quantity: '1',
});

const initialForm: BatchForm = {
  payerId: '00001',
  claimControlNumber: 'PCN001',
  diagnosisCode: 'J06.9',
  subscriberFirstName: 'JOHN',
  subscriberLastName: 'DOE',
  memberId: 'MEM8941029',
  dateOfBirth: '1985-04-12',
  gender: 'M',
  billingName: 'BILLING CLINIC',
  billingNpi: '1234567893',
  billingTaxId: '12-3456789',
  lines: [emptyLine()],
};

function lineCharge(line: ServiceLineForm): number {
  const quantity = Number(line.quantity);
  const amount = Number(line.amount);
  if (!Number.isFinite(quantity) || !Number.isFinite(amount)) {
    return 0;
  }
  return Math.round(quantity * amount * 100) / 100;
}

export default function BatchClaimTab() {
  const [form, setForm] = useState<BatchForm>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [notice, setNotice] = useState<NotificationStatus | null>(null);
  const [polling, setPolling] = useState(false);

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

  function updateLine(index: number, field: keyof ServiceLineForm, value: string) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, [field]: value } : line)),
    }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setUpload(null);
    setNotice(null);
    try {
      const result = await api<UploadResult>('/api/availity/claims/batch-submit', {
        method: 'POST',
        body: JSON.stringify({
          claimType: 'professional',
          tradingPartnerId: form.payerId.trim(),
          claimControlNumber: form.claimControlNumber.trim(),
          frequencyCode: '1',
          billingProvider: {
            npi: form.billingNpi.trim(),
            taxId: form.billingTaxId.trim(),
            name: form.billingName.trim(),
          },
          subscriber: {
            memberId: form.memberId.trim(),
            firstName: form.subscriberFirstName.trim(),
            lastName: form.subscriberLastName.trim(),
            dateOfBirth: form.dateOfBirth,
            gender: form.gender,
          },
          diagnoses: [{ code: form.diagnosisCode.trim() }],
          serviceLines: form.lines.map((line, index) => ({
            lineNumber: index + 1,
            procedureCode: line.procedureCode.trim(),
            serviceDate: line.serviceDate,
            quantity: Number(line.quantity),
            unitPrice: Number(line.amount),
            diagnosisPointer: '1',
          })),
          totalCharge,
        }),
      });
      setUpload(result);
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
              value={form.dateOfBirth}
              onChange={(event) => setForm({ ...form, dateOfBirth: event.target.value })}
            />
          </Field>
          <Field label="Gender">
            <select className={inputClass} value={form.gender} onChange={(event) => setForm({ ...form, gender: event.target.value })}>
              <option value="M">M</option>
              <option value="F">F</option>
              <option value="U">U</option>
            </select>
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

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center justify-center rounded-lg bg-availity-500 px-4 py-2 text-sm font-semibold text-white hover:bg-availity-600 disabled:opacity-60"
        >
          {submitting ? <Spinner label="Uploading batch..." /> : 'Submit batch claim'}
        </button>
        {error ? <ErrorAlert message={error} /> : null}
      </form>

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
