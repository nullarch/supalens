/** Real Overview (home dashboard) and Reports archive in the real shell; every state from local sample props, job polling intercepted. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-overview-'));
const fixture = await readFile('src/app/dev/overview/page.tsx', 'utf8');
const listOf = name => JSON.parse(fixture.match(new RegExp(`const ${name} = (\\[[^\\]]+\\])`))[1].replaceAll("'", '"').replace(/,\s*\]$/, ']'));
const homeModes = listOf('HOME_MODES');
const reportModes = listOf('REPORT_MODES');

/* ---- home dashboard expectations ---- */
const onboarding = { new: 'new', 'new-connected': 'pending_connection', 'new-viewer': 'new' };
/** data-state of the home page: the board, or the card shown before the board has widgets. */
const homeState = { home: 'board', 'home-chosen': 'board', 'home-viewer': 'board', long: 'board', draft: 'draft', 'draft-viewer': 'draft', analyzing: 'analyzing', extract: 'extract', 'empty-board': 'empty' };
const widgets = { home: 4, 'home-chosen': 2, 'home-viewer': 4, long: 4 };
// Every board card names the service it reads from (fixture order; null = the snapshot widget).
const cardSources = { home: ['my-prod', 'my-prod', 'billing', null], 'home-chosen': ['billing', null] };

/* ---- report archive expectations ---- */
const shelf = new Set(['proposals', 'extract', 'scan-failed', 'incident', 'investigating', 'degraded', 'reconnect', 'paused', 'no-ack', 'long', 'all-mixed', 'all-many', 'all-viewer', 'single-of-many']);
const railServices = { 'all-mixed': 4, 'all-quiet': 2, 'all-many': 6, 'all-viewer': 2 };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let renders = 0, documents = 0;

async function common(page, main, mode, width) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (width <= 768) {
    const trigger = page.locator('header button[aria-controls]').first();
    if (await trigger.count()) { const box = await trigger.boundingBox(); assert(box.width >= 44 && box.height >= 44); }
  }
  if (width <= 640) {
    for (const action of await main.locator('a[class*="dx-btn"], button[class*="dx-btn"], a[class*="linkCard"], a[class*="railLink"], a[class*="railService"]').all()) {
      const box = await action.boundingBox();
      if (box && box.width > 0) assert(box.height >= 44, `Touch target too small in ${mode}: ${await action.innerText()}`);
    }
  }
  for (const label of await main.locator('dt').all()) {
    const style = await label.evaluate(el => ({ size: parseFloat(getComputedStyle(el).fontSize), family: getComputedStyle(el).fontFamily }));
    assert(style.size >= 13, `dt at least 13px in ${mode}`); assert(!/mono/i.test(style.family));
  }
  for (const figure of await main.locator('dd[data-figure]').all()) {
    assert(/Iowan|Georgia|serif/i.test(await figure.evaluate(el => getComputedStyle(el).fontFamily)), 'Headline figures use the serif');
  }
  await expect(main.locator('a[href="/app/monitors?filter=pending"]')).toHaveCount(0);
}

try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    const m = JSON.parse(await readFile(`messages/${locale}.json`, 'utf8'));
    const home = m.appOverview.home, rep = m.appOverview.reports;
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    const unexpected = [], errors = [];
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(base).origin && !/^(fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net)$/.test(url.hostname)) return route.abort();
      if (url.origin === new URL(base).origin) {
        if (url.pathname === '/api/jobs/active' && request.method() === 'GET') return route.fulfill({ json: { jobs: [] } });
        if (url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method())) {
          unexpected.push(`${request.method()} ${url.pathname}`); return route.abort();
        }
      }
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/MISSING_MESSAGE|INVALID_MESSAGE/.test(message.text())) errors.push(message.text()); });

    /* ================= home dashboard ================= */
    for (const mode of homeModes) {
      assert.equal((await page.goto(`${base}/dev/overview?mode=${mode}`)).status(), 200);
      await page.evaluate(() => document.fonts.ready);
      const main = page.locator('main');

      // A wide board: on a large screen the home fills up to 1600px instead of the 1024px column.
      await page.setViewportSize({ width: 1920, height: 1000 });
      await expect.poll(() => page.evaluate(() => Math.round(document.querySelector('main [data-page-width="wide"]').getBoundingClientRect().width))).toBe(1600);

      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await common(page, main, mode, width);

        if (mode in onboarding) {
          await expect(main.locator('[class*="meta"][data-state]')).toHaveAttribute('data-state', onboarding[mode]);
          await expect(main.locator('[data-grid-id]')).toHaveCount(0);
          if (mode === 'new-viewer') {
            await expect(main.locator('a[href^="/api/connect-supabase"]')).toHaveCount(0);
            await expect(main).toContainText(home.cards.viewerNote);
          }
          if (mode === 'new') await expect(main.locator('a[href^="/api/connect-supabase/authorize"]')).toHaveCount(1);
        } else {
          await expect(main.locator('[data-view="home"]')).toHaveAttribute('data-state', homeState[mode]);
          // The board, or the card that says what is happening — never both.
          await expect(main.locator('[data-grid-id]')).toHaveCount(widgets[mode] ?? 0);
          // Each card says which service its number belongs to: one quiet line above the title that
          // never wraps, never runs under the header button, and keeps the full name on hover.
          const cards = await main.locator('[data-grid-id] [data-widget-card]').all();
          const expected = cardSources[mode] ?? cardSources.home;
          for (const [index, card] of cards.entries()) {
            const line = card.locator('[data-widget-header] [data-widget-source]');
            await expect(line).toHaveCount(1);
            const geo = await card.evaluate(el => {
              const src = el.querySelector('[data-widget-header] [data-widget-source]');
              const name = src.lastElementChild, title = el.querySelector('h3');
              const button = el.querySelector('[data-widget-header] button');
              const a = src.getBoundingClientRect(), t = title.getBoundingClientRect(), b = button.getBoundingClientRect();
              return {
                height: a.height, gap: t.top - a.bottom, clipped: name.scrollWidth > name.clientWidth,
                underButton: a.right > b.left + 0.5, title: src.getAttribute('title'), none: src.hasAttribute('data-none'),
                text: name.lastChild.textContent, // the visible name, without the screen-reader prefix
              };
            });
            assert(geo.height <= 20.5 && geo.gap >= 0, `${mode} ${width}: source line wraps or overlaps the title`);
            assert(!geo.underButton, `${mode} ${width}: source line runs under the header button`);
            if (mode !== 'long') {
              assert.equal(geo.none, expected[index] === null);
              assert.equal(geo.text, expected[index] ?? m.appDashboards.widget.sourceNone);
            }
            if (geo.clipped) assert(geo.title, `${mode} ${width}: a truncated source name keeps its full name`);
          }
          await expect(main.locator('section[class*="emptyHome"]')).toHaveCount(homeState[mode] === 'board' ? 0 : 1);
          // The home is the board alone — decisions waiting on someone live in the report archive.
          await expect(main.locator('[class*="attention"], [class*="digest"]')).toHaveCount(0);
          if (homeState[mode] === 'board' || mode === 'empty-board') {
            await expect(main.getByRole('link', { name: home.board.open, exact: true })).toHaveAttribute('href', /^\/app\/dashboards\//);
          }
          // Which board is on the Overview is a saved choice, and the lede says why: chosen, or the rule.
          // Owners/admins pick it ("Automatic" first, then every board); viewers only read the reason.
          const picker = main.getByRole('button', { name: home.board.picker, exact: true });
          if (homeState[mode] === 'board' || mode === 'empty-board') {
            const reason = mode === 'home-chosen' ? 'chosen' : 'core';
            const boardName = mode === 'home-chosen' ? '그로스 주간 지표' : mode === 'long' ? 'International subscription entitlement consistency dashboard' : '핵심 KPI';
            await expect(main.locator('header .dx-sub')).toHaveText(home.board.reason[reason].replace('{name}', boardName));
            await expect(picker).toHaveCount(mode === 'home-viewer' ? 0 : 1);
            if (mode !== 'home-viewer' && width === 1440) {
              const autoLabel = home.board.auto.replace('{name}', mode === 'home-chosen' ? '핵심 KPI' : boardName);
              await expect(picker).toContainText(mode === 'home-chosen' ? boardName : autoLabel);
              await picker.click();
              const options = page.getByRole('listbox', { name: home.board.picker }).getByRole('option');
              await expect(options).toHaveCount(mode === 'empty-board' ? 2 : 3);
              await expect(options.first()).toContainText(autoLabel);
              await page.keyboard.press('Escape');
            }
          } else {
            await expect(picker).toHaveCount(0);
          }
          if (mode === 'draft') {
            await expect(main.locator('li[class*="proposalRow"]')).toHaveCount(6);
            await expect(main.getByRole('button', { name: home.empty.draftCta, exact: true })).toHaveCount(1);
          }
          if (mode === 'draft-viewer') {
            await expect(main.getByRole('button', { name: home.empty.draftCta, exact: true })).toHaveCount(0);
            await expect(main).toContainText(home.empty.viewerNote);
          }
          if (mode === 'analyzing') await expect(main.locator('li[class*="analyzingRow"]')).toHaveCount(2);
          if (mode === 'extract') await expect(main.getByRole('link', { name: home.empty.extractCta, exact: true })).toHaveAttribute('href', /\/kpis$/);
          if (mode === 'empty-board') await expect(main.getByRole('link', { name: home.empty.askCta, exact: true })).toHaveAttribute('href', '/app/ask');
          for (const card of await main.locator('section[class*="emptyHome"]').all()) {
            assert.equal(await card.evaluate(el => getComputedStyle(el).borderRadius), '16px');
          }
        }
        renders++;
      }
      if (locale === 'en') {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.screenshot({ path: join(output, `home-${mode}-${locale}-${theme}.png`), fullPage: true });
      }
    }

    /* ================= report archive ================= */
    for (const mode of reportModes) {
      assert.equal((await page.goto(`${base}/dev/overview?page=reports&mode=${mode}`)).status(), 200);
      await page.evaluate(() => document.fonts.ready);
      const main = page.locator('main');
      const shelfHeading = main.getByRole('heading', { name: new RegExp(`^${rep.feed.needsAction}`) });

      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await common(page, main, `reports/${mode}`, width);
        if (mode === 'empty') {
          await expect(main.locator('section[class*="reportsEmpty"]')).toHaveCount(1);
          await expect(main.locator('article[data-report]')).toHaveCount(0);
          renders++;
          continue;
        }
        assert.ok(await main.locator('article[data-report]').count() > 0, `${mode} files at least one report`);
        await expect(shelfHeading).toHaveCount(shelf.has(mode) ? 1 : 0);
        for (const card of await main.locator('article[data-shelf]').all()) assert.ok(await card.getAttribute('data-action') !== null, 'Only open decisions sit on the shelf');
        if (railServices[mode]) {
          await expect(main.locator('a[class*="railService"]')).toHaveCount(railServices[mode]);
          for (const link of await main.locator('a[class*="railService"]').all()) assert.match(await link.getAttribute('href'), /^\/app\/reports\?source=/);
          await expect(main.locator('article[aria-labelledby^="service-"]')).toHaveCount(0);
        } else {
          await expect(main.locator('article[aria-labelledby^="service-"]')).toHaveCount(1);
        }
        await expect(main.locator(`nav[aria-label="${home.switcher.label}"]`)).toHaveCount(railServices[mode] || mode === 'single-of-many' ? 1 : 0);
        for (const row of await main.locator('li[data-state]').all()) {
          const health = await row.getAttribute('data-state');
          if (['paused', 'error', 'pending'].includes(health)) await expect(row.locator('[class*="value"]')).toHaveText('—');
        }
        for (const card of await main.locator('article[data-report]:not([data-compact]), article[aria-labelledby^="service-"]').all()) {
          assert.equal(await card.evaluate(el => getComputedStyle(el).borderRadius), '16px');
        }
        renders++;
      }

      if (mode !== 'empty' && theme === 'light' && (locale === 'en' || locale === 'ko')) {
        await page.setViewportSize({ width: 1440, height: 1000 });
        const first = main.locator('article[data-report]').first();
        const id = await first.getAttribute('data-report');
        await first.locator('h3 button').click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(rep.doc.reporterName);
        await expect.poll(() => new URL(page.url()).searchParams.get('report')).toBe(id);
        if (id.startsWith('incident:')) {
          await expect(dialog.getByRole('button', { name: rep.doc.ack, exact: true })).toHaveCount(mode === 'no-ack' || mode === 'all-viewer' || mode === 'incident-acked' ? 0 : 1);
          if (mode === 'all-viewer') await expect(dialog).toContainText(rep.doc.viewerNote);
          await expect(dialog).toContainText(rep.doc.section.confirmed);
        }
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect.poll(() => new URL(page.url()).searchParams.get('report')).toBe(null);
        if (await main.locator('article[data-type="daily"]').count()) {
          const tabs = main.getByRole('group', { name: rep.feed.filterLabel });
          await tabs.getByRole('button', { name: new RegExp(`^${rep.type.daily}`) }).click();
          await expect(shelfHeading).toHaveCount(0);
          const types = await main.locator('article[data-report]').evaluateAll(nodes => [...new Set(nodes.map(node => node.getAttribute('data-type')))]);
          assert.deepEqual(types, ['daily']);
          await tabs.getByRole('button', { name: new RegExp(`^${rep.type.all}`) }).click();
        }
        documents++;
        if (locale === 'en') await page.screenshot({ path: join(output, `reports-${mode}-${locale}.png`), fullPage: true });
      }
    }

    // A shared report link opens the document directly.
    await page.goto(`${base}/dev/overview?page=reports&mode=incident&report=${encodeURIComponent('incident:e1')}`);
    await expect(page.getByRole('dialog')).toBeVisible();

    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await context.close(); console.log(`PASS ${locale}/${theme}`);
  }
  console.log(JSON.stringify({ renders, documents, homeModes: homeModes.length, reportModes: reportModes.length, output }));
} finally { await browser.close(); }
