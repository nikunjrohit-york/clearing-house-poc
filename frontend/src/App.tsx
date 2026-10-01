import { useState } from 'react';
import BatchClaimTab from './components/BatchClaimTab';
import EligibilityTab from './components/EligibilityTab';
import ReportsTab from './components/ReportsTab';
import OptumClaimStatusTab from './components/optum/OptumClaimStatusTab';
import OptumClaimTab from './components/optum/OptumClaimTab';
import OptumEligibilityTab from './components/optum/OptumEligibilityTab';
import OptumReportsTab from './components/optum/OptumReportsTab';
import { SubmittedClaim } from './lib/optum-claim';

type House = 'availity' | 'optum';

const tabsByHouse: Record<House, { id: string; label: string }[]> = {
  availity: [
    { id: 'eligibility', label: 'Eligibility' },
    { id: 'batch', label: 'Batch 837 Builder' },
    { id: 'reports', label: 'Live Reports' },
  ],
  optum: [
    { id: 'eligibility', label: 'Eligibility' },
    { id: 'claim', label: 'Claim Submission' },
    { id: 'status', label: 'Claim Status' },
    { id: 'reports', label: 'Reports & ERA' },
  ],
};

export default function App() {
  const [house, setHouse] = useState<House>('optum');
  const [tab, setTab] = useState('eligibility');
  const [lastClaim, setLastClaim] = useState<SubmittedClaim | null>(null);

  function switchHouse(next: House) {
    setHouse(next);
    setTab('eligibility');
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-availity-600">
                {house === 'optum' ? 'Optum clearinghouse' : 'Availity clearinghouse'}
              </p>
              <h1 className="text-2xl font-semibold text-slate-900">Healthcare integration</h1>
            </div>
            <div className="flex rounded-lg bg-slate-100 p-1" role="group" aria-label="Clearinghouse">
              {(['availity', 'optum'] as House[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => switchHouse(item)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${
                    house === item ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                  aria-pressed={house === item}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Dashboard sections">
            {tabsByHouse[house].map((item) => (
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
        {house === 'availity' && tab === 'eligibility' ? <EligibilityTab /> : null}
        {house === 'availity' && tab === 'batch' ? <BatchClaimTab /> : null}
        {house === 'availity' && tab === 'reports' ? <ReportsTab /> : null}
        {house === 'optum' && tab === 'eligibility' ? <OptumEligibilityTab /> : null}
        {house === 'optum' && tab === 'claim' ? <OptumClaimTab onSubmitted={setLastClaim} /> : null}
        {house === 'optum' && tab === 'status' ? <OptumClaimStatusTab lastClaim={lastClaim} /> : null}
        {house === 'optum' && tab === 'reports' ? <OptumReportsTab /> : null}
      </main>
    </div>
  );
}
