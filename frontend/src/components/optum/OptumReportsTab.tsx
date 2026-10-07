import { FormEvent, useEffect, useState } from 'react';
import { StepAudit, optumErrorText, optumGet } from '../../lib/optum';
import { Badge, ErrorAlert, RawJson, Spinner, Stat, inputClass } from '../ui';

interface StatusLine {
  categoryCode: string;
  category: string;
  statusCode: string;
  description: string;
}

interface Report277 {
  acknowledgements: StatusLine[];
  rejections: StatusLine[];
  otherStatuses: StatusLine[];
  fieldErrors: { field: string; code: string; description: string; location: string }[];
}

interface Report835 {
  traceNumber: string;
  paymentMethod: string;
  totalPaidAmount: string;
  adjustments: { group: string; groupValue: string; reasonCode: string; amount: string }[];
  remarkCodes: string[];
}

type Opened = { id: string; kind: '277'; audit: StepAudit<Report277> } | { id: string; kind: '835'; audit: StepAudit<Report835> };

function kindOf(id: string): '277' | '835' | null {
  if (/^X3/i.test(id)) return '277';
  if (/^R5/i.test(id)) return '835';
  return null;
}

export default function OptumReportsTab() {
  const [reports, setReports] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState('');
  const [error, setError] = useState('');
  const [opened, setOpened] = useState<Opened | null>(null);
  const [manualId, setManualId] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const audit = await optumGet<{ reports: string[] }>('/api/optum/reports');
      setReports(audit.parsed?.reports ?? []);
    } catch (err) {
      setError(optumErrorText(err));
    } finally {
      setLoading(false);
    }
  }

  async function open(id: string) {
    const kind = kindOf(id);
    if (!kind) {
      setError(`${id} has no JSON conversion. Only X3 (277) and R5 (835) reports can be converted.`);
      return;
    }
    setOpening(id);
    setError('');
    setOpened(null);
    try {
      const path = `/api/optum/reports/${encodeURIComponent(id)}/${kind}`;
      setOpened(kind === '277' ? { id, kind, audit: await optumGet<Report277>(path) } : { id, kind, audit: await optumGet<Report835>(path) });
    } catch (err) {
      setError(optumErrorText(err));
    } finally {
      setOpening('');
    }
  }

  function onManual(event: FormEvent) {
    event.preventDefault();
    if (manualId.trim()) void open(manualId.trim());
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Claim responses and reports</h2>
          <p className="mt-1 text-sm text-slate-500">
            Optum mailbox from GET /medicalnetwork/reports/v2. X3 files are 277CA acknowledgements, R5 files are 835 remittances.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg bg-availity-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-availity-600 disabled:opacity-60"
        >
          {loading ? <Spinner label="Loading..." /> : 'Refresh mailbox'}
        </button>
      </div>

      <form onSubmit={onManual} className="flex flex-wrap items-center gap-2">
        <input className={`${inputClass} max-w-xs`} placeholder="Open report by ID, e.g. R5000000.WA" value={manualId} onChange={(event) => setManualId(event.target.value)} />
        <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          Open
        </button>
      </form>

      {error ? <ErrorAlert message={error} /> : null}

      {!loading && reports.length === 0 && !error ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">No reports in the mailbox.</p>
      ) : null}

      {reports.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white shadow-sm">
          {reports.map((id) => {
            const kind = kindOf(id);
            return (
              <li key={id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-900">{id}</span>
                  <Badge tone={kind ? 'slate' : 'amber'}>{kind === '277' ? '277 claim status' : kind === '835' ? '835 remittance' : 'X12 only'}</Badge>
                </div>
                <button
                  type="button"
                  disabled={!kind || Boolean(opening)}
                  onClick={() => void open(id)}
                  className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-200 disabled:opacity-40"
                >
                  {opening === id ? <Spinner label="Converting..." /> : 'Open'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {opened ? (
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-900">{opened.id}</h3>
            <Badge tone="slate">{opened.kind}</Badge>
            <span className="text-sm text-slate-500">HTTP {opened.audit.calls.at(-1)?.httpStatus}</span>
          </div>
          {opened.kind === '277' && opened.audit.parsed ? <Details277 report={opened.audit.parsed} /> : null}
          {opened.kind === '835' && opened.audit.parsed ? <Details835 report={opened.audit.parsed} /> : null}
          <div className="mt-4">
            <RawJson value={opened.audit} />
          </div>
        </article>
      ) : null}
    </div>
  );
}

function Details277({ report }: { report: Report277 }) {
  const lines = [
    ...report.acknowledgements.map((line) => ({ line, tone: 'border-emerald-400 text-emerald-900' })),
    ...report.rejections.map((line) => ({ line, tone: 'border-red-400 text-red-900' })),
    ...report.otherStatuses.map((line) => ({ line, tone: line.categoryCode.startsWith('F') ? 'border-emerald-400 text-emerald-900' : 'border-amber-400 text-amber-900' })),
  ];
  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-slate-600">
        {report.acknowledgements.length} accepted (A1/A2) · {report.rejections.length} rejected · {report.otherStatuses.length} other statuses
      </p>
      {lines.map(({ line, tone }, index) => {
        return (
          <div key={index} className={`border-l-4 pl-3 text-sm ${tone}`}>
            <p className="font-medium">
              {line.categoryCode} · {line.category || 'No category text'}
            </p>
            <p className="text-xs">{[line.statusCode && `Status ${line.statusCode}`, line.description].filter(Boolean).join(' · ')}</p>
          </div>
        );
      })}
      {report.fieldErrors.map((item, index) => (
        <div key={`f-${index}`} className="border-l-4 border-amber-400 pl-3 text-sm text-amber-900">
          <p className="font-medium">{item.description || item.code}</p>
          <p className="text-xs">{[item.field, item.location].filter(Boolean).join(' · ')}</p>
        </div>
      ))}
    </div>
  );
}

function Details835({ report }: { report: Report835 }) {
  return (
    <div className="mt-4 space-y-4">
      <dl className="grid gap-3 sm:grid-cols-3">
        <Stat label="Check / EFT trace" value={report.traceNumber} />
        <Stat label="Payment method" value={report.paymentMethod} />
        <Stat label="Total paid" value={report.totalPaidAmount && `$${report.totalPaidAmount}`} />
      </dl>
      {report.adjustments.length > 0 ? (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2">Group</th>
              <th className="py-2">CARC</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {report.adjustments.map((row, index) => (
              <tr key={index}>
                <td className="py-2">
                  <Badge tone={row.group === 'PR' ? 'amber' : 'slate'}>{row.group}</Badge> <span className="text-slate-600">{row.groupValue}</span>
                </td>
                <td className="py-2 font-medium text-slate-900">{row.reasonCode}</td>
                <td className="py-2 text-right font-medium text-slate-900">${row.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-slate-600">No adjustments returned.</p>
      )}
      <p className="text-sm text-slate-600">RARC remark codes: {report.remarkCodes.length ? report.remarkCodes.join(', ') : 'none'}</p>
    </div>
  );
}
