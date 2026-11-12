import { notFound } from 'next/navigation';

import '@/app/app/dashboard.css'; // .dx-* classes the app chrome renders with
import DashboardShell from '@/components/dashboard/DashboardShell';
import { PageHead } from '@/components/dashboard/PageHead';
import type { AppChrome } from '@/lib/dashboards/types';

// Dev-only visual preview of the app CHROME (editorial header + section tabs) — NO auth,
// NO DB. Mounts the REAL DashboardShell with a mock AppChrome so the organization and
// account menus, the plan meter and the mobile menu can be exercised instantly:
//   npm run dev → http://localhost:3000/dev/chrome
// notFound() in production, same as the other /dev galleries.

export const metadata = { title: 'Navigation design fixture', robots: { index: false, follow: false } };

const MOCK_CHROME: AppChrome = {
  dashboards: [
    { id: 'd1', slug: 'core-kpi', name: '핵심 KPI', pinned: true, position: 0 },
    { id: 'd2', slug: 'weekly', name: '주간 지표', pinned: false, position: 1 },
    { id: 'd3', slug: 'billing-health', name: 'International subscription entitlement consistency', pinned: false, position: 2 },
  ],
  homeDashboardId: 'd1',
  user: { name: '김하나', email: 'admin@example.com', initials: '김하', isAdmin: false },
  org: { id: 'o1', name: 'Acme', initials: 'AC' },
  orgs: [
    { id: 'o1', name: 'Acme', slug: 'acme', initials: 'AC', role: 'owner' },
    { id: 'fixture-o2', name: 'Northstar international product operations', slug: 'northstar-fixture', initials: 'NS', role: 'viewer' },
  ],
  billing: { plan: 'free', queriesUsed: 3, queriesLimit: 15, monitorsUsed: 1, monitorsLimit: 1 },
  monitors: { enabled: 1 },
};

export default function DevChromePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <DashboardShell chrome={MOCK_CHROME}>
      <main>
        <PageHead title="Navigation preview" subtitle="Sample workspace · Real navigation controls. Do not submit organization or account actions." />
        <a href="#preview-content">Skip to sample content</a>
        <div id="preview-content" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14, marginTop: 20, minHeight: 1000 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="dx-card" style={{ minHeight: 120 }} />
          ))}
        </div>
      </main>
    </DashboardShell>
  );
}
