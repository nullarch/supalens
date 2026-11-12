import { notFound } from 'next/navigation';

import '@/app/app/dashboard.css'; // .dx-* classes the sources UI renders with
import { AppSurface } from '@/components/dashboard/AppSurface';
import { SourcesClient, type SourceView, type RepoOption } from '@/app/app/sources/SourcesClient';
import { ControlsGallery } from './ControlsGallery';
import { DevThemeToggle } from './DevThemeToggle';

// Dev-only visual preview of the modal system — NO auth, NO DB, under the app tokens.
// Renders the REAL SourcesClient with mock data so the actual modals (connect-source
// picker, repo attach, context viewer, delete confirm) can be opened, plus a gallery of
// the shared dialogs, fields and Select, in light AND dark:
//   npm run dev → http://localhost:3000/dev/modals
// notFound() in production, same as the widgets gallery.

const MOCK_SOURCES: SourceView[] = [
  {
    id: '1',
    name: '프로덕션 DB',
    engine: 'postgres',
    provider: 'direct',
    status: 'active',
    isOAuth: false,
    tableCount: 23,
    lastSyncedLabel: '2시간 전',
    syncStatus: 'fresh',
    attachedRepoId: null,
    attachedRepoFullName: null,
    contextStatus: 'fresh',
    contextFromRepo: false,
    isDemo: false,
    monitorCount: 5,
    slackChannel: '#founders',
    kpiExtractionStatus: 'completed',
    kpiExtractionAt: null,
    kpiProposed: 8,
    kpiAccepted: 0,
    kpiStale: 0,
  },
  {
    id: '2',
    name: 'analytics',
    engine: 'firestore',
    provider: 'firebase',
    status: 'active',
    isOAuth: false,
    tableCount: 12,
    lastSyncedLabel: '어제',
    syncStatus: 'stale',
    attachedRepoId: 'r1',
    attachedRepoFullName: 'acme/web',
    contextFromRepo: true,
    isDemo: false,
    monitorCount: 0,
    slackChannel: null,
    contextStatus: 'stale',
    kpiExtractionStatus: null,
    kpiExtractionAt: null,
    kpiProposed: 0,
    kpiAccepted: 0,
    kpiStale: 0,
  },
];

// Enough repos (and enough near-misses) to exercise the attach modal's 추천 ranking and its
// search box, which only appears past six entries.
const MOCK_REPOS: RepoOption[] = [
  { id: 'r1', fullName: 'acme/web', defaultBranch: 'main' },
  { id: 'r2', fullName: 'acme/api', defaultBranch: 'main' },
  { id: 'r3', fullName: 'acme/analytics-web', defaultBranch: 'main' },
  { id: 'r4', fullName: 'acme/analytics-worker', defaultBranch: 'develop' },
  { id: 'r5', fullName: 'acme/marketing-site', defaultBranch: 'main' },
  { id: 'r6', fullName: 'acme/design-tokens', defaultBranch: 'main' },
  { id: 'r7', fullName: 'acme/infra', defaultBranch: 'trunk' },
];

export default function DevModalsPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <AppSurface>
      <DevThemeToggle />
      <main style={{ width: 'min(100% - 2 * var(--ax-gutter), var(--ax-content))', margin: '0 auto', padding: '48px 0 80px' }}>
        {/* SourcesClient renders the page's own head (h1); the fixture note stays a label. */}
        <p className="dx-label" style={{ margin: '0 0 32px' }}>
          Dev · modal system — open “Connect” or a card menu (delete · repository · context), then the shared primitives below
        </p>
        <SourcesClient sources={MOCK_SOURCES} repos={MOCK_REPOS} githubAppUrl="https://github.com/apps/supalens" />
        <ControlsGallery />
      </main>
    </AppSurface>
  );
}
