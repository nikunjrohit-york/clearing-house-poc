import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Badge, ErrorAlert, Spinner } from './ui';

type Filter = 'all' | 'accepted' | 'rejected';

interface ClaimNote {
  initiator?: string;
  code?: string;
  message?: string;
  loop?: string;
  segment?: string;
  element?: string;
}

interface PipeClaim {
  patientName?: string;
  dateOfService?: string;
  patientControlNumber?: string;
  status?: string;
  statusDescription?: string;
  errors?: ClaimNote[];
  warnings?: ClaimNote[];
}

interface PipeReport {
  reportType: string;
  header?: { batchId?: string; fileControlNumber?: string };
  payer?: { payerId?: string; payerName?: string };
  claims?: PipeClaim[];
  unassignedNotes?: ClaimNote[];
  rowErrors?: string[];
}

interface ElementError {
  elementPosition?: string;
  dataElementRefNumber?: string;
  errorCode?: string;
  errorDescription?: string;
  badData?: string;
}

interface SegmentError {
  segmentId?: string;
  segmentPosition?: string;
  loopId?: string;
  errorCode?: string;
  errorDescription?: string;
}

interface AckTransaction {
  transactionSetId?: string;
  controlNumber?: string;
  status?: string;
  statusDescription?: string;
  segmentErrors?: SegmentError[];
  elementErrors?: ElementError[];
}

interface AckReport {
  reportType: '999';
  functionalGroup?: { functionalId?: string; groupControlNumber?: string };
  groupAcknowledgment?: { status?: string; statusDescription?: string; acceptedSets?: number; receivedSets?: number };
  transactions?: AckTransaction[];
  rowErrors?: string[];
}

interface ReportItem {
  fileName: string;
  modifiedAt: string;
  parsed: PipeReport | AckReport | { reportType: string; rowErrors?: string[] };
  summary: {
    reportType?: string;
    status?: string;
    statusDescription?: string;
    totalAccepted?: number;
    totalRejected?: number;
    rowErrors?: string[];
  };
}

function isAck(report: ReportItem['parsed']): report is AckReport {
  return report.reportType === '999';
}

function isPipe(report: ReportItem['parsed']): report is PipeReport {
  return report.reportType !== '999' && report.reportType !== 'UNKNOWN' && 'claims' in report;
}

function claimMatches(claim: PipeClaim, filter: Filter): boolean {
  if (filter === 'all') {
    return true;
  }
  if (filter === 'accepted') {
    return claim.status === 'A';
  }
  return claim.status === 'R' || (claim.errors?.length ?? 0) > 0;
}

function reportMatches(item: ReportItem, filter: Filter): boolean {
  if (filter === 'all') {
    return true;
  }
  if (isAck(item.parsed)) {
    const status = item.parsed.groupAcknowledgment?.status;
    return filter === 'accepted' ? status === 'A' : status === 'R' || status === 'P';
  }
  if (isPipe(item.parsed)) {
    return (item.parsed.claims ?? []).some((claim) => claimMatches(claim, filter));
  }
  return false;
}

function statusLabel(status: string, description?: string): string {
  if (description) {
    return description;
  }
  if (status === 'A') {
    return 'Accepted';
  }
  if (status === 'R') {
    return 'Rejected';
  }
  if (status === 'P') {
    return 'Partial';
  }
  return status;
}

function locationLabel(note: ClaimNote): string {
  return [note.loop ? `Loop ${note.loop}` : '', note.segment ? `Segment ${note.segment}` : '', note.element ? `Element ${note.element}` : '']
    .filter(Boolean)
    .join(' · ');
}

export default function ReportsTab() {
  const [filter, setFilter] = useState<Filter>('all');
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load(refresh: boolean) {
    setLoading(true);
    setError('');
    try {
      const path = refresh ? '/api/availity/reports/poll' : '/api/availity/reports';
      const response = await api<{ reports: ReportItem[] }>(path, refresh ? { method: 'POST' } : undefined);
      setReports(response.reports ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load reports');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(false);
  }, []);

  const visible = useMemo(() => reports.filter((item) => reportMatches(item, filter)), [reports, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Reports and remittances</h2>
          <p className="mt-1 text-sm text-slate-500">Parsed IBR, EBR, DPR, and 999 files from /ReceiveFiles/.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </FilterButton>
          <FilterButton active={filter === 'accepted'} onClick={() => setFilter('accepted')}>
            Accepted
          </FilterButton>
          <FilterButton active={filter === 'rejected'} onClick={() => setFilter('rejected')}>
            Rejected
          </FilterButton>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="rounded-lg bg-availity-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-availity-600 disabled:opacity-60"
          >
            {loading ? <Spinner label="Polling..." /> : 'Poll /ReceiveFiles'}
          </button>
        </div>
      </div>

      {error ? <ErrorAlert message={error} /> : null}
      {loading && reports.length === 0 ? <Spinner label="Loading reports..." /> : null}
      {!loading && visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">
          {filter === 'all' ? 'No reports yet.' : `No ${filter} reports yet.`}
        </p>
      ) : null}

      <div className="space-y-4">
        {visible.map((item) => (
          <article key={`${item.fileName}-${item.modifiedAt}`} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-slate-900">{item.fileName}</h3>
              <Badge tone="slate">{item.summary.reportType || item.parsed.reportType}</Badge>
              {item.summary.status ? (
                <Badge tone={item.summary.status === 'A' ? 'green' : 'red'}>{statusLabel(item.summary.status, item.summary.statusDescription)}</Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-slate-500">{item.modifiedAt}</p>
            {isPipe(item.parsed) ? <PipeDetails report={item.parsed} filter={filter} /> : null}
            {isAck(item.parsed) ? <AckDetails report={item.parsed} /> : null}
            {(item.parsed.rowErrors?.length ?? 0) > 0 ? (
              <ul className="mt-4 space-y-1 text-sm text-amber-800">
                {item.parsed.rowErrors?.map((rowError) => (
                  <li key={rowError}>{rowError}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function PipeDetails({ report, filter }: { report: PipeReport; filter: Filter }) {
  const claims = (report.claims ?? []).filter((claim) => claimMatches(claim, filter));
  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-slate-600">
        Batch {report.header?.batchId || '—'} · Control {report.header?.fileControlNumber || '—'}
        {report.payer?.payerName ? ` · ${report.payer.payerName} (${report.payer.payerId || 'n/a'})` : ''}
      </p>
      {(report.unassignedNotes ?? []).map((note, noteIndex) => (
        <Reason key={`unassigned-${noteIndex}`} note={note} />
      ))}
      {claims.map((claim, index) => (
        <div key={`${claim.patientControlNumber}-${index}`} className="rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={claim.status === 'A' ? 'green' : claim.status === 'R' ? 'red' : 'amber'}>
              {claim.statusDescription || claim.status || 'Unknown'}
            </Badge>
            <span className="text-sm font-medium text-slate-900">{claim.patientName || 'Unknown patient'}</span>
            <span className="text-sm text-slate-500">{claim.patientControlNumber}</span>
            <span className="text-sm text-slate-500">{claim.dateOfService}</span>
          </div>
          {(claim.errors ?? []).map((note, noteIndex) => (
            <Reason key={`e-${noteIndex}`} note={note} />
          ))}
          {(claim.warnings ?? []).map((note, noteIndex) => (
            <Reason key={`w-${noteIndex}`} note={note} warning />
          ))}
        </div>
      ))}
    </div>
  );
}

function Reason({ note, warning = false }: { note: ClaimNote; warning?: boolean }) {
  const location = locationLabel(note);
  return (
    <div className={`mt-3 border-l-4 pl-3 text-sm ${warning ? 'border-amber-400 text-amber-900' : 'border-red-400 text-red-900'}`}>
      <p className="font-medium">
        {note.code ? `${note.code}: ` : ''}
        {note.message || 'No message text'}
      </p>
      <p className="mt-1 text-xs">
        {note.initiator ? `${note.initiator}` : 'Availity'}
        {location ? ` · ${location}` : ''}
      </p>
    </div>
  );
}

function AckDetails({ report }: { report: AckReport }) {
  const group = report.groupAcknowledgment;
  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-slate-600">
        {group?.statusDescription || 'No AK9 status'} · Functional group {report.functionalGroup?.functionalId || '—'}{' '}
        {report.functionalGroup?.groupControlNumber || ''} · Accepted {group?.acceptedSets ?? 0} of {group?.receivedSets ?? 0}
      </p>
      {(report.transactions ?? []).map((transaction, index) => (
        <div key={`${transaction.controlNumber}-${index}`} className="rounded-xl border border-slate-200 p-4 text-sm">
          <p className="font-medium text-slate-900">
            {transaction.transactionSetId || 'Transaction'} {transaction.controlNumber}{' '}
            {transaction.statusDescription ? `· ${transaction.statusDescription}` : ''}
          </p>
          {(transaction.segmentErrors ?? []).map((error, errorIndex) => (
            <p key={`ik3-${errorIndex}`} className="mt-2 border-l-4 border-red-400 pl-3 text-red-900">
              Segment {error.segmentId || 'unknown'} at position {error.segmentPosition || '—'}
              {error.loopId ? `, loop ${error.loopId}` : ''}: {error.errorDescription || error.errorCode}
            </p>
          ))}
          {(transaction.elementErrors ?? []).map((error, errorIndex) => (
            <p key={`ik4-${errorIndex}`} className="mt-2 border-l-4 border-red-400 pl-3 text-red-900">
              Element {error.elementPosition || '—'}
              {error.dataElementRefNumber ? ` (ref ${error.dataElementRefNumber})` : ''}: {error.errorDescription || error.errorCode}
              {error.badData ? `. Bad data: ${error.badData}` : ''}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
    >
      {children}
    </button>
  );
}
