import { FormEvent, useState } from 'react';
import { CoverageInquiryPayload, postCoverageInquiry } from '../lib/api';
import { Badge, ErrorPanel, Field, FillSelect, Spinner, inputClass } from './ui';

interface EligibilityForm {
  payerId: string;
  memberId: string;
  patientFirstName: string;
  patientLastName: string;
  patientBirthDate: string;
  patientGender: '' | 'M' | 'F';
  providerNpi: string;
  serviceTypeCode: string;
  procedureCode: string;
  serviceDate: string;
}

interface BenefitRow {
  label: string;
  detail: string;
}

interface EligibilityView {
  status: string;
  active: boolean;
  inactive: boolean;
  planName: string;
  copay: string;
  deductible: string;
  coinsurance: string;
  benefits: BenefitRow[];
}

const emptyForm: EligibilityForm = {
  payerId: '',
  memberId: '',
  patientFirstName: '',
  patientLastName: '',
  patientBirthDate: '',
  patientGender: '',
  providerNpi: '',
  serviceTypeCode: '30',
  procedureCode: '',
  serviceDate: '',
};

const johnDoe: EligibilityForm = {
  payerId: '00001',
  memberId: 'MEM8941029',
  patientFirstName: 'JOHN',
  patientLastName: 'DOE',
  patientBirthDate: '1985-04-12',
  patientGender: 'M',
  providerNpi: '1234567893',
  serviceTypeCode: '30',
  procedureCode: '',
  serviceDate: '',
};

const fillOptions = [
  { id: 'john-doe-plan', label: 'JOHN DOE — health benefit plan (payer 00001)', value: johnDoe },
  {
    id: 'john-doe-visit',
    label: 'JOHN DOE — office visit 99213',
    value: { ...johnDoe, serviceTypeCode: '98', procedureCode: '99213', serviceDate: '2026-09-10' },
  },
];

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
  return value.slice(0, 8).flatMap((entry) => {
    const benefit = asRecord(entry);
    if (!benefit) {
      return [];
    }
    const label = String(benefit.type || benefit.name || 'Benefit');
    const detail =
      displayMoney(benefit.copay) ||
      displayPercent(benefit.coinsurance) ||
      displayMoney(benefit.deductible) ||
      displayMoney(benefit.amount) ||
      displayPercent(benefit.percent) ||
      String(benefit.coverage || benefit.status || '');
    return [{ label, detail }];
  });
}

function readEligibility(data: unknown): EligibilityView {
  const root = asRecord(data);
  if (!root) {
    throw new Error('Availity coverage response was not an object');
  }
  const payer = asRecord(root.payer);
  const plans = Array.isArray(root.plans) ? root.plans : [];
  const plan = asRecord(plans[0]) ?? root;
  const status = String(plan.status || plan.coverageStatus || root.status || root.coverageStatus || 'Unknown');
  const benefits = benefitList(plan.benefits ?? root.benefits);
  const copayBenefit = benefits.find((row) => /copay/i.test(row.label));
  const deductibleBenefit = benefits.find((row) => /deduct/i.test(row.label));
  const coinsuranceBenefit = benefits.find((row) => /coin/i.test(row.label));
  const inactive = /^inactive\b/i.test(status);
  const active = !inactive && (/^active\b/i.test(status) || plan.statusCode === '1' || plan.statusCode === 1);

  return {
    status,
    active,
    inactive,
    planName: String(plan.planName || root.planName || payer?.name || root.payerName || ''),
    copay: displayMoney(root.copay) || displayMoney(plan.copay) || copayBenefit?.detail || 'Not returned',
    deductible: displayMoney(root.deductible) || displayMoney(plan.deductible) || deductibleBenefit?.detail || 'Not returned',
    coinsurance:
      displayPercent(root.coinsurance) || displayPercent(plan.coinsurance) || coinsuranceBenefit?.detail || 'Not returned',
    benefits,
  };
}

const COVERAGE_ERROR_CODES = new Set(['19', '7', '13', '14', '15']);

function validationText(data: unknown): string {
  const root = asRecord(data);
  if (!root || !Array.isArray(root.validationMessages)) {
    return '';
  }
  return root.validationMessages
    .map((entry) => {
      const record = asRecord(entry);
      if (typeof record?.errorMessage === 'string' && record.errorMessage.trim()) {
        return record.errorMessage.trim();
      }
      if (typeof record?.message === 'string' && record.message.trim()) {
        return record.message.trim();
      }
      return typeof entry === 'string' ? entry.trim() : '';
    })
    .filter(Boolean)
    .join('\n');
}

function coverageFault(data: unknown): string {
  const messages = validationText(data);
  if (messages) {
    return messages;
  }
  const root = asRecord(data);
  if (!root) {
    return '';
  }
  const code = typeof root.statusCode === 'number' || typeof root.statusCode === 'string' ? String(root.statusCode) : '';
  if (!COVERAGE_ERROR_CODES.has(code)) {
    return '';
  }
  if (typeof root.userMessage === 'string' && root.userMessage.trim()) {
    return root.userMessage.trim();
  }
  if (typeof root.status === 'string' && root.status.trim()) {
    return root.status.trim();
  }
  return `Availity coverage inquiry completed with statusCode ${code}.`;
}

function inquiryPayload(form: EligibilityForm): CoverageInquiryPayload {
  const payload: CoverageInquiryPayload = {
    payerId: form.payerId.trim(),
    memberId: form.memberId.trim(),
    patientFirstName: form.patientFirstName.trim(),
    patientLastName: form.patientLastName.trim(),
    patientBirthDate: form.patientBirthDate,
    providerNpi: form.providerNpi.trim(),
    serviceTypeCode: form.serviceTypeCode.trim(),
  };
  if (form.patientGender === 'M' || form.patientGender === 'F') {
    payload.patientGender = form.patientGender;
  }
  if (form.procedureCode.trim()) {
    payload.procedureCode = form.procedureCode.trim();
  }
  if (form.serviceDate) {
    payload.serviceDate = form.serviceDate;
  }
  return payload;
}

export default function EligibilityTab() {
  const [form, setForm] = useState<EligibilityForm>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<EligibilityView | null>(null);
  const [raw, setRaw] = useState<unknown>(null);

  function update<K extends keyof EligibilityForm>(field: K, value: EligibilityForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    setRaw(null);
    try {
      const response = await postCoverageInquiry(inquiryPayload(form));
      setRaw(response);
      const fault = coverageFault(response);
      if (fault) {
        setError(fault);
        return;
      }
      setResult(readEligibility(response));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eligibility request failed');
    } finally {
      setLoading(false);
    }
  }

  const tone = result?.active ? 'green' : result?.inactive ? 'red' : 'amber';
  const badge = result?.active ? 'Active' : result?.inactive ? 'Inactive' : 'Review status';

  return (
    <div className="space-y-4">
      {error ? <ErrorPanel message={error} /> : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
        <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Real-time eligibility</h2>
            <p className="mt-1 text-sm text-slate-500">
              POST /api/availity/eligibility. The API submits form fields to /availity/v1/coverages and polls GET /availity/v1/coverages/&#123;id&#125; while statusCode is 0.
            </p>
          </div>
          <FillSelect options={fillOptions} onFill={setForm} onClear={() => setForm(emptyForm)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payer ID">
              <input className={inputClass} required value={form.payerId} onChange={(event) => update('payerId', event.target.value)} />
            </Field>
            <Field label="Member ID">
              <input className={inputClass} required value={form.memberId} onChange={(event) => update('memberId', event.target.value)} />
            </Field>
            <Field label="First name">
              <input className={inputClass} required value={form.patientFirstName} onChange={(event) => update('patientFirstName', event.target.value)} />
            </Field>
            <Field label="Last name">
              <input className={inputClass} required value={form.patientLastName} onChange={(event) => update('patientLastName', event.target.value)} />
            </Field>
            <Field label="Date of birth">
              <input className={inputClass} required type="date" value={form.patientBirthDate} onChange={(event) => update('patientBirthDate', event.target.value)} />
            </Field>
            <Field label="Gender">
              <select
                className={inputClass}
                value={form.patientGender}
                onChange={(event) => update('patientGender', event.target.value === 'M' || event.target.value === 'F' ? event.target.value : '')}
              >
                <option value="">Not specified</option>
                <option value="M">M</option>
                <option value="F">F</option>
              </select>
            </Field>
            <Field label="Provider NPI">
              <input
                className={inputClass}
                required
                inputMode="numeric"
                pattern="\d{10}"
                maxLength={10}
                value={form.providerNpi}
                onChange={(event) => update('providerNpi', event.target.value)}
              />
            </Field>
            <Field label="Service type code">
              <select className={inputClass} value={form.serviceTypeCode} onChange={(event) => update('serviceTypeCode', event.target.value)}>
                <option value="30">30 — Health benefit plan</option>
                <option value="1">1 — Medical care</option>
                <option value="98">98 — Professional visit</option>
              </select>
            </Field>
            <Field label="Procedure code">
              <input
                className={inputClass}
                placeholder="99213"
                value={form.procedureCode}
                onChange={(event) => update('procedureCode', event.target.value)}
              />
            </Field>
            <Field label="Service date">
              <input className={inputClass} type="date" value={form.serviceDate} onChange={(event) => update('serviceDate', event.target.value)} />
            </Field>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center rounded-lg bg-availity-500 px-4 py-2 text-sm font-semibold text-white hover:bg-availity-600 disabled:opacity-60"
          >
            {loading ? <Spinner label="Checking coverage..." /> : 'Check coverage'}
          </button>
        </form>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Coverage</h2>
          {!result && !loading && !error ? <p className="mt-3 text-sm text-slate-500">Submit an eligibility inquiry to see benefits returned by Availity.</p> : null}
          {loading ? (
            <div className="mt-6">
              <Spinner label="Waiting for Availity..." />
            </div>
          ) : null}
          {result ? (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={tone}>{badge}</Badge>
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
              {raw ? (
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Raw response</h3>
                  <pre className="mt-2 max-h-96 overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
                    {JSON.stringify(raw, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
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
