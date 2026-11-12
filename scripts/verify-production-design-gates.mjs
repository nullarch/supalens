/** Read-only smoke test against an already-built local production server.
 * This proves these URLs are gated, not authenticated permissions or action IO. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const base = process.argv[2] || 'http://localhost:3112';
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Use a local production server');
const source = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const settings = await source('src/app/dev/settings/page.tsx');
const paths = new Set();
for (const match of settings.matchAll(/if \(view === '([^']+)'\) \{\s*if \(!([\[][\s\S]*?\])\.includes\(mode\)/g)) {
  for (const mode of JSON.parse(match[2].replaceAll("'", '"'))) paths.add(`/dev/settings?view=${match[1]}&mode=${mode}`);
}
assert(paths.has('/dev/settings?view=danger-actions&mode=signout-pending'), 'Danger modes must be discovered');
assert(paths.has('/dev/settings?view=repository-actions&mode=success'), 'Repository modes must be discovered');
for (const view of ['workspace', 'members', 'notifications', 'developer', 'plans', 'controls']) paths.add(`/dev/settings?view=${view}`);
paths.add('/dev/integrations');
const integrations = await source('src/app/dev/integrations/page.tsx');
const modes = integrations.match(/if \(!([\[][\s\S]*?\])\.includes\(mode\)/);
assert(modes, 'Integration mode list must be discovered');
for (const mode of JSON.parse(modes[1].replaceAll("'", '"'))) {
  for (const role of ['owner', 'admin', 'member', 'viewer']) paths.add(`/dev/integrations?mode=${mode}&role=${role}`);
}
const samples = await source('src/components/dashboard/widgets/__fixtures__/samples.ts');
// Reconcile every default prototype route, not only selected query variants.
let defaultPageSources = 0;
const defaultRoutes = new Set();
for (const root of ['dev', 'test']) {
  const files = await readdir(new URL(`../src/app/${root}`, import.meta.url), { recursive: true });
  for (const file of files.filter(file => /(^|\/)page\.tsx$/.test(file))) {
    defaultPageSources++;
    const route = `/${root}/${file.replace(/(^|\/)page\.tsx$/, '')}`.replace(/\/$/, '');
    if (route.includes('[')) {
      assert.equal(route, '/dev/dashboard/widgets/[type]', 'Add explicit valid samples for a new dynamic prototype');
      for (const match of samples.matchAll(/^    key: '([^']+)',/gm)) defaultRoutes.add(route.replace('[type]', match[1]));
    } else defaultRoutes.add(route);
  }
}
for (const route of defaultRoutes) paths.add(route);
const widgetFixture = await source('src/app/dev/dashboard/widgets/sample-props.ts');
const widgetModes = JSON.parse(widgetFixture.match(/WIDGET_MODES = (\[[^\]]+\])/)[1].replaceAll("'", '"'));
for (const mode of widgetModes.filter(mode => mode.startsWith('references'))) {
  paths.add(`/dev/dashboard/widgets?mode=${mode}`);
  for (const match of samples.matchAll(/^    key: '([^']+)',/gm)) paths.add(`/dev/dashboard/widgets/${match[1]}?mode=${mode}`);
}
paths.add('/dev/operations?view=editor');
paths.add('/dev/operations?view=footer');
paths.add('/dev/operations?view=grid-actions');
paths.add('/dev/operations?view=board-empty');
const analysis = await source('src/app/dev/analysis/page.tsx');
const runActionModes = analysis.match(/const RUN_ACTION_MODES = (\[[^\]]+\])/);
assert(runActionModes, 'Run action modes must be discovered');
for (const mode of JSON.parse(runActionModes[1].replaceAll("'", '"'))) paths.add(`/dev/analysis?view=actions&mode=${mode}`);
const monitorDetail = await source('src/app/dev/monitors/page.tsx');
const detailOutcomes = monitorDetail.match(/const DETAIL_OUTCOMES = (\[[^\]]+\])/);
assert(detailOutcomes, 'Monitor detail action outcomes must be discovered');
for (const outcome of JSON.parse(detailOutcomes[1].replaceAll("'", '"'))) {
  for (const role of ['owner', 'viewer']) paths.add(`/dev/monitors?view=detail-actions&outcome=${outcome}&role=${role}`);
}
const overview = await source('src/app/dev/overview/page.tsx');
const overviewModes = overview.match(/const OVERVIEW_MODES = (\[[^\]]+\])/);
assert(overviewModes, 'Overview state fixture modes must be discovered');
for (const mode of JSON.parse(overviewModes[1].replaceAll("'", '"'))) paths.add(`/dev/overview?mode=${mode}`);
paths.add('/dev/wizard?view=pill');
const wizard = await source('src/app/dev/wizard/page.tsx');
const extractionOutcomes = wizard.match(/const EXTRACTION_OUTCOMES = (\[[^\]]+\])/);
assert(extractionOutcomes, 'Wizard extraction outcomes must be discovered');
for (const state of JSON.parse(extractionOutcomes[1].replaceAll("'", '"'))) paths.add(`/dev/wizard?view=extract-actions&state=${state}`);
paths.add('/dev/wizard?view=ask-empty');
const extraction = await source('src/app/dev/kpis/extract-fixtures.ts');
const kpiPage = await source('src/app/dev/kpis/page.tsx');
const reextractModes = kpiPage.match(/const REEXTRACT_MODES = (\[[^\]]+\])/);
assert(reextractModes, 'KPI review re-extraction modes must be discovered');
for (const mode of JSON.parse(reextractModes[1].replaceAll("'", '"'))) {
  for (const variant of ['page', 'modal']) paths.add(`/dev/kpis?owner=1&mode=${mode}&variant=${variant}`);
}
const extractionModes = extraction.match(/EXTRACT_MODES = (\[[^\]]+\])/);
assert(extractionModes, 'Extraction fixture modes must be discovered');
for (const mode of JSON.parse(extractionModes[1].replaceAll("'", '"'))) paths.add(`/dev/kpis?variant=extract&mode=${mode}`);
const entry = await source('src/app/dev/entry/page.tsx');
const loginModes = entry.match(/const LOGIN_MODES = (\[[^\]]+\])/);
assert(loginModes, 'Login mode list must be discovered');
for (const mode of JSON.parse(loginModes[1].replaceAll("'", '"'))) paths.add(`/dev/entry?mode=${mode}`);
const consent = await source('src/app/dev/entry/consent/route.ts');
const consentModes = consent.match(/if \(!([\[][\s\S]*?\])\.includes\(mode\)/);
assert(consentModes, 'Consent mode list must be discovered');
paths.add('/dev/entry/consent');
for (const mode of JSON.parse(consentModes[1].replaceAll("'", '"'))) {
  paths.add(`/dev/entry/consent?mode=${mode}`);
  for (const decision of ['approve', 'deny']) paths.add(`/dev/entry/consent?mode=${mode}&decision=${decision}`);
}
paths.add('/dev/fallbacks');
paths.add('/dev/invitations');
paths.add('/dev/checkout-host');
const checkoutHost = await source('src/app/dev/checkout-host/page.tsx');
const checkoutHostModes = checkoutHost.match(/const CHECKOUT_HOST_MODES = (\[[^\]]+\])/);
assert(checkoutHostModes, 'Checkout host modes must be discovered');
for (const mode of JSON.parse(checkoutHostModes[1].replaceAll("'", '"'))) paths.add(`/dev/checkout-host?mode=${mode}`);
const invitation = await source('src/app/dev/invitations/page.tsx');
const invitationModes = invitation.match(/const INVITATION_MODES = (\[[^\]]+\])/);
assert(invitationModes, 'Invitation modes must be discovered');
for (const mode of JSON.parse(invitationModes[1].replaceAll("'", '"'))) paths.add(`/dev/invitations?mode=${mode}`);
const fallback = await source('src/app/dev/fallbacks/page.tsx');
// Every imported real loading component is exposed under one local mode key.
const loadingMap = fallback.match(/const loading = \{([\s\S]*?)\n\}/);
assert(loadingMap, 'Fallback loading map must be discovered');
const loadingModes = [...loadingMap[1].matchAll(/(?:'([^']+)'|(\w+)):\s*\w+Loading/g)].map(match => match[1] || match[2]);
assert.equal(loadingModes.length, 23);
for (const mode of ['all', 'error', 'root-error', 'not-found', ...loadingModes]) paths.add(`/dev/fallbacks?mode=${mode}`);

async function check(path, expected) {
  const response = await fetch(new URL(path, base), { redirect: 'manual', signal: AbortSignal.timeout(30000) });
  await response.arrayBuffer();
  assert.equal(response.status, expected, `${path}${response.headers.get('location') ? ` → ${response.headers.get('location')}` : ''}`);
  return response;
}
for (const path of paths) await check(path, 404);
const publicPaths = ['/', '/ko', '/ja', '/demo', '/ko/demo', '/ja/demo', '/login'];
for (const path of publicPaths) await check(path, 200);
// Missing transaction is rejected before any privileged lookup/provider setup.
await check('/proxy/checkout', 404);
for (const [path, file] of [['/icon.svg', 'src/app/icon.svg'], ['/favicon.ico', 'src/app/favicon.ico'], ['/apple-icon.png', 'src/app/apple-icon.png']]) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, path);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(new URL(`../${file}`, import.meta.url)), `Built brand asset ${path}`);
}
const anonymousPaths = ['/app/settings', '/app/settings/integrations', '/app/invite/design-verification-only'];
for (const path of anonymousPaths) {
  const response = await check(path, 307);
  assert.equal(new URL(response.headers.get('location'), base).pathname, '/login', path);
}
console.log(JSON.stringify({ fixture404: paths.size, defaultPageSources, defaultRoutes: defaultRoutes.size, public200: publicPaths.length, matchingBrandAssets: 3, anonymousLoginRedirects: anonymousPaths.length }, null, 2));
