import { FormEvent, useState } from 'react';
import { api } from '../lib/api';
import { Badge, ErrorAlert, Field, Spinner, inputClass } from './ui';

interface EligibilityForm {
  payerId: string;
  memberId: string;
  patientName: string;
  serviceTypeCode: string;
}

interface BenefitRow {
  label: string;
  detail: string;
}

interface EligibilityView {
  status: string;
  active: boolean;
  planName: string;
  copay: string;
  deductible: string;
  coinsurance: string;
  benefits: BenefitRow[];
}

const initialForm: EligibilityForm = {
  payerId: '00001',
  memberId: '',
  patientName: '',
  serviceTypeCode: '30',
};

function splitName(fullName: string): { patientFirstName?: string; patientLastName?: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return {};
  }
  if (parts.length === 1) {
    return { patientLastName: parts[0] };
  }
  return {
    patientFirstName: parts.slice(0, -1).join(' '),
    patientLastName: parts[parts.length - 1],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function displayMoney(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `$${value.toFixed(2)}`;
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim().startsWith('$') ? value.trim() : `$${value.trim()}`;
  }
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return (
    displayMoney(record.amount) ||
    displayMoney(record.individualRemaining) ||
    displayMoney(record.individualTotal) ||
    null
  );
}

function displayPercent(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}%`;
  }
  if (typeof value === 'string' && value.trim()) {
    return value.includes('%') ? value.trim() : `${value.trim()}%`;
  }
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return displayPercent(record.percent) || displayPercent(record.amount);
}

function benefitList(value: unknown): BenefitRow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, 8).map((entry) => {
    const benefit = asRecord(entry) ?? {};
    const label = String(benefit.type || benefit.name || 'Benefit');
    const detail =
      displayMoney(benefit.copay) ||
      displayPercent(benefit.coinsurance) ||
      displayMoney(benefit.deductible) ||
      String(benefit.coverage || benefit.status || benefit.amount || '');
    return { label, detail };
  });
}

function readEligibility(data: unknown): EligibilityView {
  const root = asRecord(data) ?? {};
  const plans = Array.isArray(root.plans) ? root.plans : [];
  const plan = asRecord(plans[0]) ?? root;
  const status = String(plan.status || plan.coverageStatus || root.status || root.coverageStatus || 'Unknown');
  const benefits = benefitList(plan.benefits ?? root.benefits);
  const copayBenefit = benefits.find((row) => /copay/i.test(row.label));
  const deductibleBenefit = benefits.find((row) => /deduct/i.test(row.label));
  const coinsuranceBenefit = benefits.find((row) => /coin/i.test(row.label));

  return {
    status,
    active: /active/i.test(status) || root.statusCode === '1' || plan.statusCode === '1',
    planName: String(plan.planName || root.planName || root.payerName || ''),
    copay: displayMoney(root.copay) || displayMoney(plan.copay) || copayBenefit?.detail || 'Not returned',
    deductible: displayMoney(root.deductible) || displayMoney(plan.deductible) || deductibleBenefit?.detail || 'Not returned',
    coinsurance:
      displayPercent(root.coinsurance) || displayPercent(plan.coinsurance) || coinsuranceBenefit?.detail || 'Not returned',
    benefits,
  };
}

export default function EligibilityTab() {
  const [form, setForm] = useState<EligibilityForm>(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<EligibilityView | null>(null);

  function update(field: keyof EligibilityForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const response = await api<unknown>('/api/availity/eligibility', {
        method: 'POST',
        body: JSON.stringify({
          payerId: form.payerId.trim(),
          memberId: form.memberId.trim(),
          serviceTypeCode: form.serviceTypeCode.trim() || '30',
          ...splitName(form.patientName),
        }),
      });
      setResult(readEligibility(response));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eligibility request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Real-time eligibility</h2>
          <p className="mt-1 text-sm text-slate-500">POST /api/availity/eligibility checks Availity coverages.</p>
        </div>
        <Field label="Payer ID">
          <input className={inputClass} required value={form.payerId} onChange={(event) => update('payerId', event.target.value)} />
        </Field>
        <Field label="Member ID">
          <input className={inputClass} required value={form.memberId} onChange={(event) => update('memberId', event.target.value)} />
        </Field>
        <Field label="Patient name">
          <input
            className={inputClass}
            placeholder="John Doe"
            value={form.patientName}
            onChange={(event) => update('patientName', event.target.value)}
          />
        </Field>
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
            <Spinner label="Waiting for Availity..." />
          </div>
        ) : null}
        {result ? (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={result.active ? 'green' : 'amber'}>{result.active ? 'Active' : 'Review status'}</Badge>
              <span className="text-sm font-medium text-slate-800">{result.status}</span>
            </div>
            {result.planName ? <p className="text-sm text-slate-600">{result.planName}</p> : null}
            <dl className="grid gap-3 sm:grid-cols-3">
              <BenefitStat label="Copay" value={result.copay} />
              <BenefitStat label="Deductible" value={result.deductible} />
              <BenefitStat label="Coinsurance" value={result.coinsurance} />
            </dl>
            {result.benefits.length > 0 ? (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {result.benefits.map((benefit) => (
                  <li key={`${benefit.label}-${benefit.detail}`} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                    <span className="text-slate-700">{benefit.label}</span>
                    <span className="font-medium text-slate-900">{benefit.detail || '—'}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function BenefitStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
