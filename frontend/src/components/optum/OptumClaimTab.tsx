import { FormEvent, useMemo, useState } from 'react';
import { StepAudit, blankForm, controlNumber, optumErrorText, optumPost, ymd } from '../../lib/optum';
import { SubmittedClaim } from '../../lib/optum-claim';
import { Badge, ErrorAlert, Field, FillSelect, RawJson, Spinner, Stat, inputClass } from '../ui';

interface ClaimWarning {
  field: string;
  code: string;
  description: string;
  location: string;
}

interface ClaimResult {
  claimControlNumber: string;
  submissionStatus: string;
  warnings: ClaimWarning[];
}

interface LineForm {
  procedureCode: string;
  amount: string;
  units: string;
  serviceDate: string;
  pointers: string;
}

// Sandbox claim from the Professional Claims v3 Postman collection.
const sampleForm = {
  tradingPartnerServiceId: '9496',
  receiverName: 'EXTRA HEALTHY INSURANCE',
  submitterName: 'REGIONAL PPO NETWORK',
  submitterContact: 'SUBMITTER CONTACT INFO',
  submitterPhone: '123456789',
  memberId: '0000000001',
  firstName: 'johnone',
  lastName: 'doeOne',
  dateOfBirth: '1980-01-02',
  gender: 'M',
  address1: '123 address1',
  city: 'city1',
  state: 'wa',
  postalCode: '981010000',
  billingName: 'HAPPY DOCTORS GROUPPRACTICE',
  billingNpi: '1760854442',
  billingTaxId: '123456789',
  billingAddress1: '000 address1',
  billingCity: 'city2',
  billingState: 'tn',
  billingPostalCode: '372030000',
  patientControlNumber: '12345',
  placeOfServiceCode: '11',
  claimFilingCode: 'CI',
  codeSet: 'icd9',
  diagnoses: '496, 25000',
  lines: [
    { procedureCode: 'E0570', amount: '25', units: '1', serviceDate: '2005-05-14', pointers: '1,2' },
    { procedureCode: 'A7003', amount: '3.75', units: '1', serviceDate: '2005-05-14', pointers: '1' },
  ] as LineForm[],
};

type FormState = typeof sampleForm;

const emptyLine = (): LineForm => ({ procedureCode: '', amount: '', units: '1', serviceDate: '', pointers: '1' });

const emptyForm = { ...blankForm(sampleForm, ['gender', 'placeOfServiceCode', 'claimFilingCode', 'codeSet']), lines: [emptyLine()] };

export default function OptumClaimTab({ onSubmitted }: { onSubmitted: (claim: SubmittedClaim) => void }) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState<'' | 'validate' | 'submit'>('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ mode: 'validate' | 'submit'; audit: StepAudit<ClaimResult> } | null>(null);

  const total = useMemo(() => form.lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0), [form.lines]);

  function update<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateLine(index: number, field: keyof LineForm, value: string) {
    update(
      'lines',
      form.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, [field]: value } : line)),
    );
  }

  function buildClaim() {
    const dx = form.diagnoses.split(',').map((code) => code.trim().replace('.', '')).filter(Boolean);
    const [principal, other] = form.codeSet === 'icd10' ? ['ABK', 'ABF'] : ['BK', 'BF'];
    const address = { address1: form.address1, city: form.city, state: form.state, postalCode: form.postalCode };
    const billingAddress = { address1: form.billingAddress1, city: form.billingCity, state: form.billingState, postalCode: form.billingPostalCode };
    return {
      controlNumber: controlNumber(),
      tradingPartnerServiceId: form.tradingPartnerServiceId.trim(),
      submitter: {
        organizationName: form.submitterName,
        contactInformation: { name: form.submitterContact, phoneNumber: form.submitterPhone },
      },
      receiver: { organizationName: form.receiverName },
      subscriber: {
        memberId: form.memberId.trim(),
        paymentResponsibilityLevelCode: 'P',
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        gender: form.gender,
        dateOfBirth: ymd(form.dateOfBirth),
        address,
      },
      providers: [
        {
          providerType: 'BillingProvider',
          npi: form.billingNpi.trim(),
          employerId: form.billingTaxId.replace(/\D/g, ''),
          organizationName: form.billingName,
          address: billingAddress,
        },
      ],
      claimInformation: {
        claimFilingCode: form.claimFilingCode,
        patientControlNumber: form.patientControlNumber.trim(),
        claimChargeAmount: total.toFixed(2),
        placeOfServiceCode: form.placeOfServiceCode,
        claimFrequencyCode: '1',
        signatureIndicator: 'Y',
        planParticipationCode: 'A',
        benefitsAssignmentCertificationIndicator: 'Y',
        releaseInformationCode: 'Y',
        healthCareCodeInformation: dx.map((code, index) => ({ diagnosisTypeCode: index === 0 ? principal : other, diagnosisCode: code })),
        serviceLines: form.lines.map((line) => ({
          serviceDate: ymd(line.serviceDate),
          professionalService: {
            procedureIdentifier: 'HC',
            lineItemChargeAmount: line.amount,
            procedureCode: line.procedureCode.trim(),
            measurementUnit: 'UN',
            serviceUnitCount: line.units,
            compositeDiagnosisCodePointers: { diagnosisCodePointers: line.pointers.split(',').map((item) => item.trim()).filter(Boolean) },
          },
        })),
      },
    };
  }

  async function send(mode: 'validate' | 'submit') {
    setBusy(mode);
    setError('');
    setResult(null);
    try {
      const path = mode === 'validate' ? '/api/optum/claims/validation' : '/api/optum/claims/submission';
      const audit = await optumPost<ClaimResult>(path, buildClaim());
      setResult({ mode, audit });
      if (mode === 'submit') {
        const dates = form.lines.map((line) => line.serviceDate).filter(Boolean).sort();
        onSubmitted({
          tradingPartnerServiceId: form.tradingPartnerServiceId,
          memberId: form.memberId,
          firstName: form.firstName,
          lastName: form.lastName,
          dateOfBirth: form.dateOfBirth,
          gender: form.gender,
          dateFrom: dates[0] ?? '',
          dateTo: dates.at(-1) ?? '',
          chargeAmount: total.toFixed(2),
          patientControlNumber: form.patientControlNumber,
          billingName: form.billingName,
          billingNpi: form.billingNpi,
          billingTaxId: form.billingTaxId,
          claimControlNumber: audit.parsed?.claimControlNumber ?? '',
        });
      }
    } catch (err) {
      setError(optumErrorText(err));
    } finally {
      setBusy('');
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send('submit');
  }

  const text = (field: keyof FormState, label: string, extra: Record<string, unknown> = {}) => (
    <Field label={label}>
      <input className={inputClass} value={form[field] as string} onChange={(event) => update(field, event.target.value as never)} {...extra} />
    </Field>
  );

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Professional claim (837P)</h2>
          <p className="mt-1 text-sm text-slate-500">
            Validate runs Optum's edits without sending to the payer. Submit posts to /medicalnetwork/professionalclaims/v3/submission and returns the clearinghouse claim number. Payer
            acknowledgements arrive later as 277CA reports.
          </p>
        </div>
        <FillSelect
          options={[{ id: 'johnone', label: 'johnone doeOne — professional claim (payer 9496)', value: sampleForm }]}
          onFill={setForm}
          onClear={() => setForm(emptyForm)}
        />

        <div className="grid gap-4 md:grid-cols-3">
          {text('tradingPartnerServiceId', 'Trading partner (payer) ID', { required: true })}
          {text('receiverName', 'Payer name', { required: true })}
          {text('patientControlNumber', 'Patient control number', { required: true })}
        </div>

        <fieldset className="grid gap-4 md:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold text-slate-800">Submitter</legend>
          {text('submitterName', 'Organization', { required: true })}
          {text('submitterContact', 'Contact name', { required: true })}
          {text('submitterPhone', 'Phone', { required: true })}
        </fieldset>

        <fieldset className="grid gap-4 md:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold text-slate-800">Subscriber</legend>
          {text('firstName', 'First name', { required: true })}
          {text('lastName', 'Last name', { required: true })}
          {text('memberId', 'Member ID', { required: true })}
          {text('dateOfBirth', 'Date of birth', { required: true, type: 'date' })}
          <Field label="Gender">
            <select className={inputClass} value={form.gender} onChange={(event) => update('gender', event.target.value)}>
              <option value="M">M</option>
              <option value="F">F</option>
            </select>
          </Field>
          {text('address1', 'Address', { required: true })}
          {text('city', 'City', { required: true })}
          {text('state', 'State', { required: true, maxLength: 2 })}
          {text('postalCode', 'ZIP', { required: true })}
        </fieldset>

        <fieldset className="grid gap-4 md:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold text-slate-800">Billing provider</legend>
          {text('billingName', 'Organization', { required: true })}
          {text('billingNpi', 'NPI', { required: true, inputMode: 'numeric' })}
          {text('billingTaxId', 'Tax ID (EIN)', { required: true })}
          {text('billingAddress1', 'Address', { required: true })}
          {text('billingCity', 'City', { required: true })}
          {text('billingState', 'State', { required: true, maxLength: 2 })}
          {text('billingPostalCode', 'ZIP', { required: true })}
        </fieldset>

        <fieldset className="grid gap-4 md:grid-cols-4">
          <legend className="mb-2 text-sm font-semibold text-slate-800">Claim</legend>
          <Field label="Place of service">
            <select className={inputClass} value={form.placeOfServiceCode} onChange={(event) => update('placeOfServiceCode', event.target.value)}>
              <option value="11">11 — Office</option>
              <option value="02">02 — Telehealth</option>
              <option value="22">22 — Outpatient hospital</option>
              <option value="12">12 — Home</option>
            </select>
          </Field>
          <Field label="Claim filing code">
            <select className={inputClass} value={form.claimFilingCode} onChange={(event) => update('claimFilingCode', event.target.value)}>
              <option value="CI">CI — Commercial</option>
              <option value="MB">MB — Medicare Part B</option>
              <option value="MC">MC — Medicaid</option>
              <option value="HM">HM — HMO</option>
            </select>
          </Field>
          <Field label="Diagnosis code set">
            <select className={inputClass} value={form.codeSet} onChange={(event) => update('codeSet', event.target.value)}>
              <option value="icd10">ICD-10 (ABK / ABF)</option>
              <option value="icd9">ICD-9 (BK / BF)</option>
            </select>
          </Field>
          {text('diagnoses', 'Diagnoses (comma separated)', { required: true })}
        </fieldset>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Service lines</h3>
            <button type="button" className="text-sm font-medium text-availity-600 hover:text-availity-700" onClick={() => update('lines', [...form.lines, emptyLine()])}>
              Add line
            </button>
          </div>
          {form.lines.map((line, index) => (
            <div key={index} className="grid gap-3 rounded-xl border border-slate-200 p-3 md:grid-cols-[1fr_1fr_80px_1fr_1fr_auto]">
              <Field label="CPT / HCPCS">
                <input className={inputClass} required value={line.procedureCode} onChange={(event) => updateLine(index, 'procedureCode', event.target.value)} />
              </Field>
              <Field label="Charge">
                <input className={inputClass} required inputMode="decimal" value={line.amount} onChange={(event) => updateLine(index, 'amount', event.target.value)} />
              </Field>
              <Field label="Units">
                <input className={inputClass} required inputMode="numeric" value={line.units} onChange={(event) => updateLine(index, 'units', event.target.value)} />
              </Field>
              <Field label="Date">
                <input className={inputClass} required type="date" value={line.serviceDate} onChange={(event) => updateLine(index, 'serviceDate', event.target.value)} />
              </Field>
              <Field label="Dx pointers">
                <input className={inputClass} required value={line.pointers} onChange={(event) => updateLine(index, 'pointers', event.target.value)} />
              </Field>
              <div className="flex items-end">
                <button
                  type="button"
                  className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                  disabled={form.lines.length === 1}
                  onClick={() => update('lines', form.lines.filter((_, lineIndex) => lineIndex !== index))}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <p className="text-sm text-slate-600">
            Claim total <span className="font-semibold text-slate-900">${total.toFixed(2)}</span>
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void send('validate')}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
          >
            {busy === 'validate' ? <Spinner label="Validating..." /> : 'Validate claim'}
          </button>
          <button
            type="submit"
            disabled={Boolean(busy)}
            className="rounded-lg bg-availity-500 px-4 py-2 text-sm font-semibold text-white hover:bg-availity-600 disabled:opacity-60"
          >
            {busy === 'submit' ? <Spinner label="Submitting..." /> : 'Submit claim'}
          </button>
        </div>
        {error ? <ErrorAlert message={error} /> : null}
      </form>

      {result ? <ClaimReceipt mode={result.mode} audit={result.audit} /> : null}
    </div>
  );
}

function ClaimReceipt({ mode, audit }: { mode: 'validate' | 'submit'; audit: StepAudit<ClaimResult> }) {
  const parsed = audit.parsed;
  const callData = audit.calls.at(-1)?.data;
  const raw = (callData && typeof callData === 'object' ? callData : {}) as {
    claimReference?: Record<string, string>;
    editStatus?: string;
  };
  const reference = raw.claimReference && typeof raw.claimReference === 'object' ? raw.claimReference : {};
  const ok = /success/i.test(parsed?.submissionStatus ?? '');
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{mode === 'validate' ? 'Validation result' : 'Submission receipt'}</h2>
          <p className="mt-1 text-sm text-slate-500">
            HTTP {audit.calls.at(-1)?.httpStatus} · {audit.calls.at(-1)?.at}
          </p>
        </div>
        <Badge tone={ok ? 'green' : 'amber'}>{parsed?.submissionStatus || 'No status'}</Badge>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Claim control number" value={parsed?.claimControlNumber ?? ''} />
        <Stat label="Correlation ID" value={reference.correlationId ?? ''} />
        <Stat label="Patient control #" value={reference.patientControlNumber ?? ''} />
        <Stat label="Edit status" value={raw.editStatus ?? ''} />
      </dl>
      {(parsed?.warnings.length ?? 0) > 0 ? (
        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold text-slate-800">Validation warnings</h3>
          {parsed?.warnings.map((warning, index) => (
            <div key={index} className="border-l-4 border-amber-400 pl-3 text-sm text-amber-900">
              <p className="font-medium">
                {warning.code ? `${warning.code}: ` : ''}
                {warning.description || 'No description'}
              </p>
              <p className="text-xs">{[warning.field, warning.location].filter(Boolean).join(' · ')}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-600">No validation warnings returned.</p>
      )}
      {mode === 'submit' ? <p className="mt-4 text-sm text-slate-600">Next: check Claim status, or open Reports for the payer's 277CA.</p> : null}
      <div className="mt-4">
        <RawJson value={audit} />
      </div>
    </section>
  );
}
