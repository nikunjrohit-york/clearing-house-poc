import { FormEvent, useState } from 'react';
import { StepAudit, blankForm, controlNumber, optumErrorText, optumPost, ymd } from '../../lib/optum';
import { SubmittedClaim } from '../../lib/optum-claim';
import { Badge, ErrorAlert, Field, RawJson, SampleButtons, Spinner, inputClass } from '../ui';

interface ClaimStatusRow {
  categoryCode: string;
  category: string;
  description: string;
  payerClaimControlNumber: string;
  claimServiceDate: string;
  submittedAmount: string;
  amountPaid: string;
  paidDate: string;
  checkIssueDate: string;
  checkNumber: string;
}

interface ClaimStatusParsed {
  adjudication: ClaimStatusRow[];
}

// Sandbox inquiry from the Claim Status v2 Postman collection.
const sampleForm = {
  tradingPartnerServiceId: 'serviceId',
  billingName: 'TestProvider',
  billingTaxId: '0123456789',
  serviceProviderName: 'happy doctors group',
  serviceProviderNpi: '1760854442',
  memberId: '0000000000',
  firstName: 'johnone',
  lastName: 'doeone',
  dateOfBirth: '1880-01-02',
  gender: 'M',
  dateFrom: '2010-01-01',
  dateTo: '2010-01-02',
  submittedAmount: '',
  trackingNumber: 'ABCD',
};

type FormState = typeof sampleForm;

const emptyForm = blankForm(sampleForm, ['gender']);

export default function OptumClaimStatusTab({ lastClaim }: { lastClaim: SubmittedClaim | null }) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<StepAudit<ClaimStatusParsed> | null>(null);

  function update(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function useLastClaim() {
    if (!lastClaim) return;
    setForm((current) => ({
      ...current,
      tradingPartnerServiceId: lastClaim.tradingPartnerServiceId,
      billingName: lastClaim.billingName,
      billingTaxId: lastClaim.billingTaxId,
      serviceProviderName: lastClaim.billingName,
      serviceProviderNpi: lastClaim.billingNpi,
      memberId: lastClaim.memberId,
      firstName: lastClaim.firstName,
      lastName: lastClaim.lastName,
      dateOfBirth: lastClaim.dateOfBirth,
      gender: lastClaim.gender,
      dateFrom: lastClaim.dateFrom,
      dateTo: lastClaim.dateTo,
      submittedAmount: lastClaim.chargeAmount,
      trackingNumber: lastClaim.patientControlNumber,
    }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      setResult(
        await optumPost<ClaimStatusParsed>('/api/optum/claim-status', {
          controlNumber: controlNumber(),
          tradingPartnerServiceId: form.tradingPartnerServiceId.trim(),
          providers: [
            { organizationName: form.billingName, taxId: form.billingTaxId.replace(/\D/g, ''), providerType: 'BillingProvider' },
            { organizationName: form.serviceProviderName, npi: form.serviceProviderNpi.trim(), providerType: 'ServiceProvider' },
          ],
          subscriber: {
            memberId: form.memberId.trim(),
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            gender: form.gender,
            dateOfBirth: ymd(form.dateOfBirth),
          },
          encounter: {
            beginningDateOfService: ymd(form.dateFrom),
            endDateOfService: ymd(form.dateTo),
            ...(form.trackingNumber.trim() ? { trackingNumber: form.trackingNumber.trim() } : {}),
            ...(form.submittedAmount.trim() ? { submittedAmount: form.submittedAmount.trim() } : {}),
          },
        }),
      );
    } catch (err) {
      setError(optumErrorText(err));
    } finally {
      setLoading(false);
    }
  }

  const rows = result?.parsed?.adjudication ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Claim status (276/277)</h2>
          <p className="mt-1 text-sm text-slate-500">POST /medicalnetwork/claimstatus/v2. Real-time inquiry by member, service dates, and charge amount.</p>
        </div>
        <SampleButtons onSample={() => setForm(sampleForm)} onClear={() => setForm(emptyForm)} />
        {lastClaim ? (
          <button type="button" onClick={useLastClaim} className="text-sm font-medium text-availity-600 hover:text-availity-700">
            Fill from last submitted claim {lastClaim.claimControlNumber ? `(${lastClaim.claimControlNumber})` : ''}
          </button>
        ) : null}
        <Field label="Trading partner (payer) ID">
          <input className={inputClass} required value={form.tradingPartnerServiceId} onChange={(event) => update('tradingPartnerServiceId', event.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Billing provider">
            <input className={inputClass} required value={form.billingName} onChange={(event) => update('billingName', event.target.value)} />
          </Field>
          <Field label="Billing tax ID">
            <input className={inputClass} required value={form.billingTaxId} onChange={(event) => update('billingTaxId', event.target.value)} />
          </Field>
          <Field label="Service provider">
            <input className={inputClass} required value={form.serviceProviderName} onChange={(event) => update('serviceProviderName', event.target.value)} />
          </Field>
          <Field label="Service provider NPI">
            <input className={inputClass} required value={form.serviceProviderNpi} onChange={(event) => update('serviceProviderNpi', event.target.value)} />
          </Field>
          <Field label="Member ID">
            <input className={inputClass} required value={form.memberId} onChange={(event) => update('memberId', event.target.value)} />
          </Field>
          <Field label="Gender">
            <select className={inputClass} value={form.gender} onChange={(event) => update('gender', event.target.value)}>
              <option value="M">M</option>
              <option value="F">F</option>
            </select>
          </Field>
          <Field label="First name">
            <input className={inputClass} required value={form.firstName} onChange={(event) => update('firstName', event.target.value)} />
          </Field>
          <Field label="Last name">
            <input className={inputClass} required value={form.lastName} onChange={(event) => update('lastName', event.target.value)} />
          </Field>
          <Field label="Date of birth">
            <input className={inputClass} type="date" required value={form.dateOfBirth} onChange={(event) => update('dateOfBirth', event.target.value)} />
          </Field>
          <Field label="Charge amount">
            <input className={inputClass} inputMode="decimal" placeholder="Optional" value={form.submittedAmount} onChange={(event) => update('submittedAmount', event.target.value)} />
          </Field>
          <Field label="Service from">
            <input className={inputClass} type="date" required value={form.dateFrom} onChange={(event) => update('dateFrom', event.target.value)} />
          </Field>
          <Field label="Service to">
            <input className={inputClass} type="date" required value={form.dateTo} onChange={(event) => update('dateTo', event.target.value)} />
          </Field>
        </div>
        <Field label="Tracking number">
          <input className={inputClass} value={form.trackingNumber} onChange={(event) => update('trackingNumber', event.target.value)} />
        </Field>
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center rounded-lg bg-availity-500 px-4 py-2 text-sm font-semibold text-white hover:bg-availity-600 disabled:opacity-60"
        >
          {loading ? <Spinner label="Checking status..." /> : 'Check claim status'}
        </button>
        {error ? <ErrorAlert message={error} /> : null}
      </form>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Payer response</h2>
        {!result && !loading ? <p className="mt-3 text-sm text-slate-500">Submit an inquiry to see where the claim is in adjudication.</p> : null}
        {loading ? (
          <div className="mt-6">
            <Spinner label="Waiting for the payer..." />
          </div>
        ) : null}
        {result ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-500">
              HTTP {result.calls.at(-1)?.httpStatus} · {rows.length} claim{rows.length === 1 ? '' : 's'} returned
            </p>
            {rows.length === 0 ? <p className="text-sm text-slate-600">The payer returned no claim status records.</p> : null}
            {rows.map((row, index) => (
              <div key={index} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={categoryTone(row.categoryCode)}>{row.categoryCode || '—'}</Badge>
                  <span className="text-sm font-medium text-slate-900">{row.category || 'No category text'}</span>
                </div>
                {row.description ? <p className="mt-1 text-sm text-slate-600">{row.description}</p> : null}
                <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <Pair label="Payer claim #" value={row.payerClaimControlNumber} />
                  <Pair label="Service date" value={row.claimServiceDate} />
                  <Pair label="Billed" value={row.submittedAmount && `$${row.submittedAmount}`} />
                  <Pair label="Paid" value={row.amountPaid && `$${row.amountPaid}`} />
                  <Pair label="Adjudicated" value={row.paidDate} />
                  <Pair label="Payment date" value={row.checkIssueDate} />
                  <Pair label="Check / EFT #" value={row.checkNumber} />
                </dl>
              </div>
            ))}
            <RawJson value={result} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function categoryTone(code?: string): 'green' | 'red' | 'amber' | 'slate' {
  if (!code) return 'slate';
  if (code.startsWith('F')) return code === 'F2' ? 'red' : 'green';
  if (code === 'A3' || code === 'A4' || code === 'A6' || code === 'A7' || code === 'A8') return 'red';
  return 'amber';
}

function Pair({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}
