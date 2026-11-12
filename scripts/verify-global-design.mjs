/** Read-only visual regression smoke checks against an already running dev server.
 * Usage: node scripts/verify-global-design.mjs http://localhost:3107
 * No real connection, payment, notification or monitor action is submitted.
 */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const baseURL = process.argv[2] || 'http://localhost:3107';
const output = await mkdtemp(join(tmpdir(), 'supalens-design-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const failures = [];
let checks = 0;

async function inspect(page, route, label, screenshot = false) {
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  try {
    const response = await page.goto(`${baseURL}${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    assert.equal(response?.status(), 200, `${route}: HTTP status`);
    await page.evaluate(() => document.fonts.ready);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      // Recharts intentionally debounces ResizeObserver by 80ms. Wait for layout
      // to settle, but still fail persistent document overflow.
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, undefined, { timeout: 1500 }).catch(() => {});
      const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(layout.scroll <= layout.width + 1, `${label} ${width}px: page overflows to ${layout.scroll}px`);
      checks++;
    }
    assert.deepEqual(errors, [], `${label}: browser errors`);
    if (screenshot) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: join(output, `${label}.png`), fullPage: true });
    }
    console.log(`PASS ${label}`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    console.error(`FAIL ${label}: ${error.message}`);
  } finally {
    page.off('pageerror', onError);
  }
}

try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    const page = await context.newPage();
    for (const locale of ['en', 'ko', 'ja']) {
      const route = locale === 'en' ? '/' : `/${locale}`;
      await inspect(page, route, `landing-${locale}-${theme}`, locale === 'en');
      assert.equal(await page.locator('#hero-title').count(), 1);
      assert.equal(await page.locator('html').getAttribute('lang'), locale);
      const missingAnchors = await page.locator('a[href^="#"]').evaluateAll(links => links.map(link => link.getAttribute('href')).filter(href => href.length > 1 && !document.getElementById(href.slice(1))));
      assert.deepEqual(missingAnchors, [], 'Landing anchor destinations');
    }
    // Marketing sets NEXT_LOCALE. Reset explicitly before testing app fixtures.
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: baseURL }]);
    for (const [route, label] of [
      ['/supabase', 'supabase'], ['/demo', 'demo'], ['/login', 'login'],
      ['/privacy', 'privacy'], ['/docs/mcp', 'mcp-docs'],
      ['/dev/overview?mode=incident', 'overview-incident'],
      ['/dev/overview?mode=healthy', 'overview-healthy'],
      ['/dev/overview?mode=degraded', 'overview-degraded'],
      ['/dev/overview?mode=overflow', 'overview-overflow'],
      ['/dev/overview?mode=setup', 'overview-setup'],
      ['/dev/overview?view=setup-picker', 'setup-picker'],
      ['/dev/incidents', 'incidents'], ['/dev/business-model', 'business-model'],
      ['/dev/ask-view', 'ask'], ['/dev/integrations', 'integrations'],
      ['/dev/dashboard/report-preview', 'report-board'],
      ['/dev/modals', 'source-cards'],
    ]) await inspect(page, route, `${label}-${theme}`, ['overview-incident', 'incidents'].includes(label));
    for (const locale of ['en', 'ko', 'ja']) {
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: baseURL }]);
      for (const view of ['workspace', 'members', 'notifications', 'developer', 'plans', 'controls']) {
        await inspect(page, `/dev/settings?view=${view}`, `settings-${view}-${locale}-${theme}`, locale === 'en' && ['workspace', 'notifications', 'plans'].includes(view));
      }
      for (const view of ['workspace', 'members', 'notifications', 'developer']) {
        await inspect(page, `/dev/settings?view=${view}&role=viewer`, `settings-${view}-viewer-${locale}-${theme}`);
      }
      for (const mode of ['review', 'empty', 'failed']) {
        await inspect(page, `/dev/kpis?mode=${mode}`, `kpis-${mode}-${locale}-${theme}`, locale === 'en' && mode === 'review');
      }
    }
    await context.close();
  }
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  const menu = page.locator('button[aria-controls="cx-mobile-menu"]');
  await menu.click();
  assert.equal(await menu.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await menu.getAttribute('aria-expanded'), 'false');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const before = await page.locator('html').getAttribute('data-theme');
  await page.locator('header button[aria-label*="Switch to"]').filter({ visible: true }).click();
  assert.notEqual(await page.locator('html').getAttribute('data-theme'), before);
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.notEqual(await page.locator('html').getAttribute('data-theme'), before, 'Theme persists');
  await page.locator('details summary').first().click();
  assert.equal(await page.locator('details').first().getAttribute('open'), '');
  await context.close();
  console.log('PASS marketing menu, keyboard Escape, theme persistence, product evidence disclosure');
} catch (error) {
  failures.push(error.message);
  console.error(error);
} finally {
  await browser.close();
  console.log(`Checked ${checks} viewport cases. Screenshots: ${output}`);
  if (failures.length) {
    console.error(`${failures.length} failures remain.`);
    process.exitCode = 1;
  }
}
