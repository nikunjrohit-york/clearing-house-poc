import { FormEvent, useState } from 'react';
import { StepAudit, blankForm, controlNumber, optumErrorText, optumPost, ymd } from '../../lib/optum';
import { Badge, ErrorAlert, Field, FillSelect, RawJson, Spinner, Stat, inputClass } from '../ui';

interface Benefit {
  name: string;
  coverageLevel: string;
  serviceTypes: string[];
  amount: string;
  percent: string;
  timeQualifier: string;
  network: string;
}

interface Eligibility {
  activeCoverage: { statusCode: string; status: string; serviceTypeCodes: string[] }[];
  copays: Benefit[];
  deductibles: Benefit[];
  coinsurance: Benefit[];
  outOfPocketMaximums: Benefit[];
}

// Optum sandbox test member from the Eligibility v3 Postman collection.
const sampleForm = {
  tradingPartnerServiceId: '87726',
  providerName: 'provider_name',
  providerNpi: '0123456789',
  memberId: '0000000000',
  firstName: 'johnOne',
  lastName: 'doeOne',
  dateOfBirth: '1880-01-02',
  gender: 'M',
  serviceTypeCode: '30',
  dateFrom: '2010-01-01',
  dateTo: '2010-01-02',
};

const emptyForm = blankForm(sampleForm, ['gender', 'serviceTypeCode']);

export default function OptumEligibilityTab() {
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<StepAudit<Eligibility> | null>(null);

  function update(field: keyof typeof sampleForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      setResult(
        await optumPost<Eligibility>('/api/optum/eligibility', {
          controlNumber: controlNumber(),
          tradingPartnerServiceId: form.tradingPartnerServiceId.trim(),
          provider: { organizationName: form.providerName.trim(), npi: form.providerNpi.trim() },
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
            serviceTypeCodes: [form.serviceTypeCode],
          },
        }),
      );
    } catch (err) {
      setError(optumErrorText(err));
    } finally {
      setLoading(false);
    }
  }

  const parsed = result?.parsed;
  const active = (parsed?.activeCoverage.length ?? 0) > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Real-time eligibility (270/271)</h2>
          <p className="mt-1 text-sm text-slate-500">POST /medicalnetwork/eligibility/v3. Optum answers in real time with the payer's 271.</p>
        </div>
        <FillSelect
          options={[{ id: 'johnone', label: 'johnOne doeOne — payer 87726', value: sampleForm }]}
          onFill={setForm}
          onClear={() => setForm(emptyForm)}
        />
        <Field label="Trading partner (payer) ID">
          <input className={inputClass} required value={form.tradingPartnerServiceId} onChange={(event) => update('tradingPartnerServiceId', event.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider organization">
            <input className={inputClass} required value={form.providerName} onChange={(event) => update('providerName', event.target.value)} />
          </Field>
          <Field label="Provider NPI">
            <input className={inputClass} required inputMode="numeric" value={form.providerNpi} onChange={(event) => update('providerNpi', event.target.value)} />
          </Field>
        </div>
        <Field label="Member ID">
          <input className={inputClass} required value={form.memberId} onChange={(event) => update('memberId', event.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">
            <input className={inputClass} required value={form.firstName} onChange={(event) => update('firstName', event.target.value)} />
          </Field>
          <Field label="Last name">
            <input className={inputClass} required value={form.lastName} onChange={(event) => update('lastName', event.target.value)} />
          </Field>
          <Field label="Date of birth">
            <input className={inputClass} type="date" required value={form.dateOfBirth} onChange={(event) => update('dateOfBirth', event.target.value)} />
          </Field>
          <Field label="Gender">
            <select className={inputClass} value={form.gender} onChange={(event) => update('gender', event.target.value)}>
              <option value="M">M</option>
              <option value="F">F</option>
            </select>
          </Field>
          <Field label="Service from">
            <input className={inputClass} type="date" required value={form.dateFrom} onChange={(event) => update('dateFrom', event.target.value)} />
          </Field>
          <Field label="Service to">
            <input className={inputClass} type="date" required value={form.dateTo} onChange={(event) => update('dateTo', event.target.value)} />
          </Field>
        </div>
        <Field label="Service type code">
          <select className={inputClass} value={form.serviceTypeCode} onChange={(event) => update('serviceTypeCode', event.target.value)}>
            <option value="30">30 — Health benefit plan</option>
            <option value="1">1 — Medical care</option>
            <option value="98">98 — Professional visit</option>
          </select>
        </Field>
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center rounded-lg bg-availity-500 px-4 py-2 text-sm font-semibold text-white hover:bg-availity-600 disabled:opacity-60"
        >
          {loading ? <Spinner label="Checking coverage..." /> : 'Check coverage'}
        </button>
        {error ? <ErrorAlert message={error} /> : null}
      </form>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Coverage</h2>
        {!result && !loading ? <p className="mt-3 text-sm text-slate-500">Submit an eligibility inquiry to see benefits.</p> : null}
        {loading ? (
          <div className="mt-6">
            <Spinner label="Waiting for Optum..." />
          </div>
        ) : null}
        {parsed ? (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={active ? 'green' : 'amber'}>{active ? 'Active coverage' : 'No active coverage returned'}</Badge>
              <span className="text-sm text-slate-500">HTTP {result?.calls.at(-1)?.httpStatus}</span>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Stat label="Copay" value={firstMoney(parsed.copays, 'amount')} />
              <Stat label="Deductible" value={firstMoney(parsed.deductibles, 'amount')} />
              <Stat label="Coinsurance" value={firstMoney(parsed.coinsurance, 'percent')} />
              <Stat label="Out-of-pocket max" value={firstMoney(parsed.outOfPocketMaximums, 'amount')} />
            </dl>
            <BenefitTable
              rows={[
                ...parsed.copays.map((row) => ['Copay', row] as const),
                ...parsed.deductibles.map((row) => ['Deductible', row] as const),
                ...parsed.coinsurance.map((row) => ['Coinsurance', row] as const),
                ...parsed.outOfPocketMaximums.map((row) => ['Out of pocket', row] as const),
              ]}
            />
            <PayerBenefits data={result?.calls.at(-1)?.data} />
            <RawJson value={result} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

interface RawBenefit {
  name?: string;
  insuranceType?: string;
  planCoverage?: string;
  coverageLevel?: string;
  serviceTypes?: string[];
  benefitsDateInformation?: Record<string, string>;
}

function PayerBenefits({ data }: { data: unknown }) {
  const root = data && typeof data === 'object' ? (data as { benefitsInformation?: RawBenefit[]; payer?: { name?: string; payorIdentification?: string } }) : {};
  const rows = Array.isArray(root.benefitsInformation) ? root.benefitsInformation : [];
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-800">
        Benefits returned{root.payer?.name ? ` by ${root.payer.name}` : ''}
        {root.payer?.payorIdentification ? ` (${root.payer.payorIdentification})` : ''}
      </h3>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {rows.map((row, index) => (
          <li key={index} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
            <span className="text-slate-700">
              {row.name || 'Benefit'}
              <span className="block text-xs text-slate-500">
                {[row.insuranceType, row.planCoverage, row.coverageLevel, row.serviceTypes?.join(', ')].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="text-right text-xs text-slate-500">
              {Object.entries(row.benefitsDateInformation && typeof row.benefitsDateInformation === 'object' ? row.benefitsDateInformation : {})
                .map(([kind, range]) => `${kind} ${range}`)
                .join(', ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function firstMoney(rows: Benefit[], field: 'amount' | 'percent'): string {
  const value = rows.find((row) => row[field])?.[field];
  if (!value) return 'Not returned';
  return field === 'percent' ? `${Math.round(Number(value) * 100)}%` : `$${value}`;
}

function BenefitTable({ rows }: { rows: (readonly [string, Benefit])[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
      {rows.map(([kind, row], index) => (
        <li key={`${kind}-${index}`} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
          <span className="text-slate-700">
            {kind}
            <span className="block text-xs text-slate-500">
              {[row.coverageLevel, row.network, row.timeQualifier, row.serviceTypes.join(', ')].filter(Boolean).join(' · ')}
            </span>
          </span>
          <span className="font-medium text-slate-900">{row.amount ? `$${row.amount}` : row.percent ? `${Math.round(Number(row.percent) * 100)}%` : '—'}</span>
        </li>
      ))}
    </ul>
  );
}
