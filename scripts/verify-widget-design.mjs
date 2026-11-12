import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-widget-design-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const fixtureSource = await readFile(new URL('../src/app/dev/dashboard/widgets/sample-props.ts', import.meta.url), 'utf8');
const modes = JSON.parse(fixtureSource.match(/WIDGET_MODES = (\[[^\]]+\])/)[1].replaceAll("'", '"'));
let renders = 0, widgets = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) {
    const { appDashboards: { widget: t } } = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
      await context.addInitScript(value => localStorage.setItem('theme', value), theme);
      const errors = [], mutations = [];
      await context.route('**/*', route => {
        const request = route.request(), url = request.url();
        if (url.startsWith(base) && (!['GET', 'HEAD'].includes(request.method()) || new URL(url).pathname.startsWith('/api/'))) { mutations.push(url); return route.abort(); }
        if (!url.startsWith(base) && !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(new URL(url).hostname)) return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (/MISSING_MESSAGE|INVALID_MESSAGE|Encountered two children/.test(m.text())) errors.push(m.text()); });
      for (const mode of modes) {
        assert.equal((await page.goto(`${base}/dev/dashboard/widgets?mode=${mode}`)).status(), 200);
        await page.evaluate(() => document.fonts.ready);
        const samples = page.locator('[data-widget-sample]');
        await expect(samples).toHaveCount(15);
        if (!['loading', 'error', 'empty', 'invalid-data', 'missing'].includes(mode)) await expect(samples.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15000 });
        const line = page.locator('[data-widget-sample="line"]');
        if (mode === 'empty') await expect(line.getByRole('status')).toHaveText(t.empty);
        if (mode === 'invalid-data') { await expect(line.getByRole('alert')).toContainText(t.invalidData); await expect(line.getByText(t.empty, { exact: true })).toHaveCount(0); }
        if (mode === 'error') await expect(line.getByRole('alert')).toContainText(t.error);
        if (mode === 'loading') await expect(line.getByRole('status', { name: t.loading })).toHaveAttribute('aria-busy', 'true');
        if (mode === 'missing') await expect(line.getByRole('alert')).toContainText(t.missingColumns.split('{columns}')[0]);
        if (mode === 'nonnumeric') await expect(line.getByRole('status')).toHaveText(t.needsNumericValues);
        const pie = page.locator('[data-widget-sample="pie"]');
        if (mode === 'zero') await expect(pie.getByRole('status')).toHaveText(t.zeroTotal);
        if (['negative', 'nonnumeric'].includes(mode)) await expect(pie.getByRole('status')).toHaveText(t.needsNonNegativeValues);
        if (mode === 'invalid-time') await expect(line.getByText(t.timeUnavailable, { exact: true })).toBeVisible();
        if (mode === 'future-time') await expect(line.locator('time')).toHaveAttribute('datetime', '2099-01-01T00:00:00.000Z');
        if (['long', 'fill'].includes(mode)) await expect(line.getByRole('heading')).toHaveText('SampleBusinessSignal_'.repeat(6).slice(0, 120));
        await expect(samples.getByRole('button', { name: t.menu, exact: true })).toHaveCount(0);
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), { timeout: 5000, message: `${mode}/${locale}/${theme}/${width}` }).toBe(true);
          // ChartFrame coalesces resize events for 80ms. Wait for every local chart,
          // not just the document (a scrolled chart may not affect document bounds).
          await expect.poll(() => samples.evaluateAll(nodes => nodes.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.getAttribute('data-widget-sample'))),
            { timeout: 3000, message: `Widget overflow ${mode}/${width}` }).toEqual([]);
          widgets += await samples.count();
          renders++;
          if (mode.startsWith('references')) {
            const labels = samples.locator('[data-reference-name]');
            await expect(labels).toHaveCount(28);
            await expect(samples.locator('[data-reference-legend]')).toHaveCount(7);
            await expect(samples.locator('text.recharts-label')).toHaveCount(0);
            if (mode !== 'references') {
              await expect(samples.locator('[data-reference-coincident]')).toHaveCount(14);
              await expect(line.locator('[data-reference-name]').nth(0)).toHaveText('LongUnbrokenReferenceName'.repeat(2).slice(0, 40));
              await expect(line.locator('[data-reference-name]').nth(1)).toHaveText('결제 완료 후 접근 권한 누락 확인 기준선 '.repeat(2).slice(0, 40).trim());
              await expect(line.locator('[data-reference-name]').nth(2)).toHaveText('支払い完了後のアクセス権限確認の基準値'.repeat(3).slice(0, 40));
              await expect(line.locator('[data-reference-name]').nth(3)).toHaveText(t.references.unnamed.replace('{number}', '4'));
            }
            const readings = await labels.evaluateAll(nodes => nodes.map(el => {
              const style = getComputedStyle(el);
              let host = el.parentElement;
              while (host && ['transparent', 'rgba(0, 0, 0, 0)'].includes(getComputedStyle(host).backgroundColor)) host = host.parentElement;
              const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
              const ink = luminance(style.color), background = luminance(host ? getComputedStyle(host).backgroundColor : 'rgb(255, 255, 255)');
              const bounds = el.getBoundingClientRect(), row = el.closest('li').getBoundingClientRect();
              return { size: style.fontSize, family: style.fontFamily, contrast: (Math.max(ink, background) + .05) / (Math.min(ink, background) + .05), inside: bounds.top >= row.top - 1 && bounds.bottom <= row.bottom + 1 && bounds.left >= row.left - 1 && bounds.right <= row.right + 1, overflow: el.scrollWidth > el.clientWidth + 1 };
            }));
            for (const style of readings) {
              assert.equal(style.size, '13px'); assert(!/mono/i.test(style.family)); assert(style.contrast >= 4.5, `Reference label contrast ${style.contrast}`); assert(style.inside && !style.overflow, `Clipped reference label ${locale}/${theme}/${width}`);
            }
            for (const sample of await samples.all()) {
              if (!await sample.locator('[data-reference-legend]').count()) continue;
              const lines = sample.locator('.recharts-reference-line-line');
              await expect(lines).toHaveCount(4);
              const expectedDashes = ['4 4', '9 3', '2 3', '9 3 2 3'];
              for (let index = 0; index < 4; index++) {
                await expect(lines.nth(index)).toHaveAttribute('stroke-dasharray', expectedDashes[index]);
                await expect(sample.locator('[data-reference-entry] svg line').nth(index)).toHaveAttribute('stroke-dasharray', expectedDashes[index]);
              }
              const bounds = await sample.locator('[data-reference-plot]').boundingBox();
              assert(bounds.height >= 180 && bounds.width > 0, 'Legend must not collapse the plot');
              if (mode !== 'references') {
                const coords = await lines.evaluateAll(nodes => nodes.map(el => ['x1', 'x2', 'y1', 'y2'].map(attr => el.getAttribute(attr)).join('/')));
                assert.equal(coords[0], coords[1], 'Identical values must stay on the same coordinate');
              }
            }
            const exactToggle = line.locator('[data-reference-legend] summary');
            await exactToggle.focus(); await page.keyboard.press('Enter');
            await expect(line.locator('[data-reference-legend] details')).toHaveAttribute('open', '');
            const raw = await line.locator('[data-reference-exact]').allTextContents();
            assert.equal(raw.length, 4);
            if (mode !== 'references') { assert.equal(raw[0], raw[1]); assert.notEqual(raw[1], raw[2]); assert.equal(raw[3], '0'); }
            await page.keyboard.press('Enter');
            await expect(line.locator('[data-reference-legend] details')).not.toHaveAttribute('open', '');
            interactions++;
            if (mode === 'references-fill') {
              const content = line.getByRole('group', { name: t.content, exact: true });
              await content.focus(); await page.keyboard.press('Control+End');
              await expect.poll(() => content.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
              const plot = line.locator('[data-reference-plot]');
              const original = (await plot.boundingBox()).height;
              const host = line.locator('[class*="fillHost"]');
              await host.evaluate(el => { el.style.height = '1400px'; });
              await expect.poll(async () => (await plot.boundingBox()).height).toBeGreaterThan(original + 100);
              await host.evaluate(el => { el.style.height = ''; });
              interactions++;
            }
            if (width === 320 && mode !== 'references') await line.screenshot({ path: join(output, `line-${mode}-${locale}-${theme}.png`) });
          }
          if (locale === 'en' && width === 320 && ['ready', 'long', 'fill', 'error', 'invalid-data', 'zero'].includes(mode)) {
            for (const key of ['bignumber', 'pie', 'table']) await page.locator(`[data-widget-sample="${key}"]`).screenshot({ path: join(output, `${key}-${mode}-${theme}.png`) });
          }
        }
        if (mode === 'long') {
          const table = page.locator('[data-widget-sample="table"] [role="region"]');
          await table.focus(); await expect(table).toBeFocused();
          if (await table.evaluate(el => el.scrollWidth > el.clientWidth + 1)) {
            await page.keyboard.press('ArrowRight');
            await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
          }
          interactions++;
        }
        if (mode === 'fill') {
          const header = line.getByRole('group', { name: t.details, exact: true });
          await header.focus(); await page.keyboard.press('End');
          await expect.poll(() => header.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
          const content = page.locator('[data-widget-sample="table"]').getByRole('group', { name: t.content, exact: true });
          await content.focus(); await expect(content).toBeFocused(); interactions += 2;
        }
      }
      assert.deepEqual(errors, []); assert.deepEqual(mutations, []);
      await context.close(); console.log(`PASS widgets ${locale}/${theme}`);
    }
  }
  console.log(JSON.stringify({ renders, widgets, interactions, screenshots: output }, null, 2));
} finally { await browser.close(); }
