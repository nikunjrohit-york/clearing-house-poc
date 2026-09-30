import { useState } from 'react';
import BatchClaimTab from './components/BatchClaimTab';
import EligibilityTab from './components/EligibilityTab';
import ReportsTab from './components/ReportsTab';

type TabId = 'eligibility' | 'batch' | 'reports';

const tabs: { id: TabId; label: string }[] = [
  { id: 'eligibility', label: 'Eligibility' },
  { id: 'batch', label: 'Batch 837 Builder' },
  { id: 'reports', label: 'Live Reports' },
];

export default function App() {
  const [tab, setTab] = useState<TabId>('eligibility');

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-availity-600">Availity clearinghouse</p>
            <h1 className="text-2xl font-semibold text-slate-900">Healthcare integration</h1>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Dashboard sections">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  tab === item.id ? 'bg-availity-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
                aria-current={tab === item.id ? 'page' : undefined}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {tab === 'eligibility' ? <EligibilityTab /> : null}
        {tab === 'batch' ? <BatchClaimTab /> : null}
        {tab === 'reports' ? <ReportsTab /> : null}
      </main>
    </div>
  );
}
