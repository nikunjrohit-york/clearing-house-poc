import { ReactNode, useState } from 'react';

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-600">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-availity-500" aria-hidden="true" />
      {label}
    </span>
  );
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
      {message}
    </div>
  );
}

export function ErrorAlert({ message }: { message: string }) {
  return <ErrorPanel message={message} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export function FillSelect<T>({
  options,
  onFill,
  onClear,
}: {
  options: { id: string; label: string; value: T }[];
  onFill: (value: T) => void;
  onClear: () => void;
}) {
  const [selected, setSelected] = useState('');
  return (
    <Field label="Fill inputs">
      <select
        className={inputClass}
        value={selected}
        onChange={(event) => {
          const id = event.target.value;
          setSelected(id);
          if (!id) {
            onClear();
            return;
          }
          const option = options.find((item) => item.id === id);
          if (option) {
            onFill(structuredClone(option.value));
          }
        }}
      >
        <option value="">Choose an example to fill these fields</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-availity-500 focus:border-availity-500 focus:ring-2';

export function RawJson({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} className="text-sm font-medium text-availity-600 hover:text-availity-700">
        {open ? 'Hide raw JSON' : 'Show raw JSON'}
      </button>
      {open ? (
        <pre className="mt-2 max-h-96 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
          {JSON.stringify(value, (key, item) => (key === 'client_id' || key === 'client_secret' || key === 'access_token' ? '***' : item), 2)}
        </pre>
      ) : null}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-all text-base font-semibold text-slate-900">{value || 'Not returned'}</dd>
    </div>
  );
}

export function Badge({ tone, children }: { tone: 'green' | 'red' | 'amber' | 'slate'; children: ReactNode }) {
  const tones = {
    green: 'bg-emerald-100 text-emerald-800',
    red: 'bg-red-100 text-red-800',
    amber: 'bg-amber-100 text-amber-800',
    slate: 'bg-slate-100 text-slate-700',
  };
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
