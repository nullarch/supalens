/** Public demo console against intercepted demo responses (every locale and theme).
 * Every POST /api/demo/ask is fulfilled in-browser, so no question reaches the application.
 * Typed questions are used because suggested questions may open a preloaded live answer.
 * Usage: node scripts/verify-demo-presentation.mjs http://localhost:3107
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107', origin = new URL(base).origin;
const output = await mkdtemp(join(tmpdir(), 'supalens-demo-presentation-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], unexpected = [];
let viewportChecks = 0, interactions = 0;

const FIXTURE_SQL = 'select 42 as fixture_value';
const fixtureAnswer = {
  text: '## Local fixture\n\nIntercepted example — **no database query**.\n\n- first point\n- second point',
  visualizations: [{
    v: 1,
    query: { sql: FIXTURE_SQL },
    sample: { columns: ['fixture_value'], rows: [{ fixture_value: 42 }] },
    chart: { type: 'bignumber', title: 'Fixture value', value: 'fixture_value' },
  }],
};

try {
  for (const theme of ['light', 'dark']) for (const locale of ['en', 'ko', 'ja']) {
    const t = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8')).demo;
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addInitScript(value => {
      localStorage.setItem('theme', value);
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } });
    }, theme);
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: origin }]);
    let mode = 'cached', requests = [];
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin && url.pathname === '/api/demo/ask') {
        requests.push(request.postDataJSON());
        if (mode === 'pending') await new Promise(resolve => setTimeout(resolve, 800));
        const status = mode === 'error' ? 500 : mode === 'limited' ? 429 : mode === 'unavailable' ? 503 : 200;
        const body = status === 200
          ? { mode: 'cached', runId: 'fixture', result: fixtureAnswer, answeredAt: new Date(Date.now() - 3_600_000).toISOString() }
          : { error: mode === 'limited' ? 'rate_limited' : mode === 'unavailable' ? 'demo_unavailable' : 'fixture_error' };
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      }
      if (url.origin !== origin && !/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.hostname)) return route.abort();
      if (url.origin === origin && (!['GET', 'HEAD'].includes(request.method()) || url.pathname.startsWith('/api/'))) {
        unexpected.push(request.method() + ' ' + url.pathname); return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const region = () => page.getByRole('region', { name: t.console.label, exact: true });
    const askTyped = async question => {
      const input = region().getByRole('textbox', { name: t.console.placeholder, exact: true });
      await input.fill(question); await input.press('Enter');
    };
    const clear = () => region().getByRole('button', { name: t.console.clear, exact: true }).click();
    const fixtureVisible = () => expect(region().getByText('Intercepted example —', { exact: false })).toBeVisible();

    await page.goto(base + (locale === 'en' ? '' : '/' + locale) + '/demo');
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole('heading', { level: 1, name: t.title })).toBeVisible();
    for (const group of Object.values(t.console.groups)) await expect(region().getByText(group, { exact: true })).toBeVisible();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      assert.ok((await region().boundingBox()).height >= 540, `${locale} ${width}: console too short`);
      viewportChecks++;
    }

    // Answer with markdown, SQL disclosure and copy.
    await page.setViewportSize({ width: 1440, height: 1000 });
    requests = [];
    await askTyped('Fixture question');
    await fixtureVisible();
    await expect(region().locator('ul > li', { hasText: 'second point' })).toBeVisible();
    await region().locator('summary', { hasText: 'SQL' }).click();
    await expect(region().getByLabel('SQL', { exact: true })).toContainText(FIXTURE_SQL);
    await region().getByRole('button', { name: t.answer.copy, exact: true }).click();
    await expect(region().getByRole('button', { name: t.answer.copied, exact: true })).toBeVisible();
    assert.deepEqual(requests, [{ question: 'Fixture question', locale }]);
    interactions += 3;
    await region().screenshot({ path: join(output, `answer-${locale}-${theme}.png`) });

    for (mode of ['pending', 'limited', 'unavailable', 'error']) {
      await clear(); requests = [];
      await askTyped(`Fixture ${mode}`);
      if (mode === 'pending') {
        await expect(region().getByRole('status').filter({ hasText: t.answer.starting })).toBeVisible();
        await fixtureVisible();
      } else if (mode === 'limited') {
        await expect(region().getByRole('status').filter({ hasText: t.notices.rateLimited })).toBeVisible();
        await expect(region().getByRole('link', { name: t.notices.connect, exact: true })).toBeVisible();
      } else if (mode === 'unavailable') {
        await expect(region().getByRole('status').filter({ hasText: t.notices.unavailable })).toBeVisible();
      } else {
        await expect(region().getByRole('alert').filter({ hasText: t.notices.error })).toBeVisible();
        mode = 'cached';
        await region().getByRole('button', { name: t.notices.retry, exact: true }).click();
        await fixtureVisible();
        interactions++;
      }
      assert.equal(requests.length, mode === 'cached' ? 2 : 1); interactions++;
    }

    // A story asks the console and brings it into view on a phone.
    await clear();
    await page.setViewportSize({ width: 390, height: 844 });
    const story = t.stories.items[1];
    await page.getByRole('button', { name: t.stories.ask, exact: false }).nth(1).click();
    await expect(region().getByText(story.question)).toBeVisible();
    await expect.poll(() => region().evaluate(el => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; })).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    interactions++; viewportChecks++;

    await context.close(); console.log(`PASS ${locale} ${theme}`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ viewportChecks, interactions, output }));
} finally { await browser.close(); }
