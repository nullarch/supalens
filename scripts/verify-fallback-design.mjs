/** Actual fallback/loading presentations plus an isolated document rendering the
 * actual GlobalError with ONLY Sentry replaced by a local recording stub.
 * No production crash, real error report, auth or database operation is induced. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const publicOnly = process.argv.includes('--public');
const output = await mkdtemp(join(tmpdir(), 'supalens-fallback-design-'));
const browser = await chromium.launch({ channel: 'chrome' });
let renders = 0, loadingInspections = 0, interactions = 0, isolatedDocuments = 0;
const loadingFiles = (await readdir(new URL('../src/app/app/', import.meta.url), { recursive: true })).filter(file => file.endsWith('loading.tsx'));

// Bundle in memory using the already-installed local toolchain. The entry mounts
// a real React document, with no Next root layout, intl, Supabase, CSS or router.
const bundle = await rolldown({
  input: 'virtual:fallback', platform: 'browser', tsconfig: false,
  resolve: { alias: { '@': resolve('src') } },
  transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': '"production"' } },
  plugins: [{ name: 'isolated-fallback',
    resolveId(id) { if (id === 'virtual:fallback' || id === '@sentry/nextjs') return '\0' + id; },
    load(id) {
      if (id === '\0@sentry/nextjs') return `export function captureException(){window.__reports=(window.__reports||0)+1;if(window.__throwReport)throw new Error('Local reporting failure')}`;
      if (id === '\0virtual:fallback') return `import React from 'react';import {createRoot} from 'react-dom/client';import GlobalError from ${JSON.stringify(resolve('src/app/global-error.tsx'))};window.__retries=0;createRoot(document).render(React.createElement(GlobalError,{error:new Error('PRIVATE_EXCEPTION_NOT_FOR_UI'),reset:()=>{window.__retries++}}));`;
    },
  }],
});
const generated = await bundle.generate({ format: 'iife' });
const isolatedHtml = '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' + generated.output[0].code.replaceAll('</script', '<\\/script') + '</script></body></html>';
await bundle.close();

async function checkSurface(page, label) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), { message: label }).toBe(true);
  await expect(page.locator('.sl-fallback h1')).toHaveCount(1);
  const readings = await page.locator('.sl-fallback-action').evaluateAll(nodes => nodes.map(el => {
    const s = getComputedStyle(el), b = el.getBoundingClientRect();
    const lum = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const fg = lum(s.color), bg = lum(s.backgroundColor);
    return { radius: s.borderRadius, height: b.height, contrast: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05), inside: b.left >= 0 && b.right <= innerWidth + 1 };
  }));
  for (const r of readings) { assert.equal(r.radius, '10px'); assert(r.height >= 44); assert(r.contrast >= 4.5); assert(r.inside); }
}

try {
  for (const locale of ['en', 'ko', 'ja']) {
    const { appChrome: t } = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
      await context.addInitScript(value => localStorage.setItem('theme', value), theme);
      const errors = [], forbidden = [];
      await context.route('**/*', route => {
        const r = route.request(), url = new URL(r.url());
        if (url.origin === new URL(base).origin && (!['GET', 'HEAD'].includes(r.method()) || url.pathname.startsWith('/api/'))) { forbidden.push(r.url()); return route.abort(); }
        if (url.origin !== new URL(base).origin && !['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'].includes(url.hostname)) return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (/MISSING_MESSAGE|INVALID_MESSAGE|hydration/i.test(m.text())) errors.push(m.text()); });
      for (const mode of publicOnly ? ['public-404'] : ['all', 'error', 'root-error', 'not-found', 'public-404']) {
        const path = mode === 'public-404' ? '/__missing_fallback_design__' : `/dev/fallbacks?mode=${mode}`;
        assert.equal((await page.goto(base + path)).status(), mode === 'public-404' ? 404 : 200, `${locale}/${theme}/${path}`);
        await page.evaluate(() => document.fonts.ready);
        if (mode === 'all') await expect(page.locator('[data-loading-sample]')).toHaveCount(loadingFiles.length);
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
          if (mode === 'all') {
            for (const sample of await page.locator('[data-loading-sample]').all()) {
              await expect(sample.getByRole('status')).toHaveText(t.loading);
              await expect(sample.getByRole('table')).toHaveCount(0);
              await expect(sample.getByRole('button')).toHaveCount(0);
              const findings = await sample.evaluate(el => ({ overflow: el.scrollWidth > el.clientWidth + 1, animated: [...el.querySelectorAll('span[aria-hidden]')].some(block => getComputedStyle(block).animationName !== 'none') }));
              assert(!findings.overflow, `Loading overflow ${await sample.getAttribute('data-loading-sample')}/${width}`);
              assert(!findings.animated, 'Reduced motion should stop placeholder animation');
              loadingInspections++;
            }
          } else {
            await checkSurface(page, `${mode}/${locale}/${theme}/${width}`);
            if (mode === 'error' || mode.endsWith('404') || mode === 'not-found') await expect(page.locator('.sl-fallback h1')).toHaveText(mode === 'error' ? t.error.title : t.notFound.body);
            if (mode === 'not-found') await expect(page.locator('.sl-fallback-action')).toHaveAttribute('href', '/app/ask');
            if (mode === 'public-404') await expect(page.locator('.sl-fallback-primary')).toHaveAttribute('href', locale === 'en' ? '/' : `/${locale}`);
          }
          renders++;
          if (width === 320 && mode !== 'all') await page.locator('.sl-fallback').screenshot({ path: join(output, `${mode}-${locale}-${theme}.png`) });
        }
        if (mode === 'all') for (const key of ['ask', 'sources', 'kpis', 'integrations', 'monitor-detail']) await page.locator(`[data-loading-sample="${key}"]`).screenshot({ path: join(output, `loading-${key}-${locale}-${theme}.png`) });
        if (mode === 'error' || mode === 'root-error') {
          const retry = page.locator('.sl-fallback button');
          await retry.focus(); await page.keyboard.press('Enter');
          await expect(page.getByRole('status')).toContainText('Local retry callbacks: 1.');
          await expect(retry).toBeFocused(); interactions++;
        }
      }
      assert.deepEqual(errors, []); assert.deepEqual(forbidden, []);
      await context.close();

      // Cookie-driven /app failure and route-driven marketing failure; both with
      // stored preference and blocked storage/system fallback. Reporting throws
      // in the blocked case, proving it cannot destroy the last-resort UI.
      for (const routed of [false, true]) for (const blocked of [false, true]) {
        const isolated = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: blocked ? theme : theme === 'dark' ? 'light' : 'dark' });
        await isolated.addCookies([{ name: 'NEXT_LOCALE', value: routed ? (locale === 'ko' ? 'ja' : 'ko') : locale, url: base }]);
        await isolated.addInitScript(({ theme, blocked }) => {
          window.__throwReport = blocked;
          if (blocked) Object.defineProperty(window, 'localStorage', { get() { throw new Error('Blocked storage'); } });
          else localStorage.setItem('theme', theme);
        }, { theme, blocked });
        const isolatedErrors = [], unexpected = [];
        await isolated.route('**/*', route => {
          if (new URL(route.request().url()).pathname.endsWith('/__root_fallback_fixture__')) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: isolatedHtml });
          unexpected.push(route.request().url()); return route.abort();
        });
        const root = await isolated.newPage();
        root.on('pageerror', e => isolatedErrors.push(e.message));
        await root.goto(`${base}/${routed ? locale : 'app'}/__root_fallback_fixture__`);
        try { await expect(root.locator('html')).toHaveAttribute('lang', locale); }
        catch (error) { console.error({ isolatedErrors, unexpected }); throw error; }
        await expect(root.locator('.sl-fallback h1')).toHaveText({ en: 'This page could not load', ko: '화면을 불러오지 못했습니다', ja: 'ページを読み込めませんでした' }[locale]);
        await expect.poll(() => root.evaluate(() => window.__reports)).toBe(1);
        await expect(root.locator('body')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(21, 22, 24)' : 'rgb(251, 252, 252)');
        await expect(root.locator('body')).not.toContainText('PRIVATE_EXCEPTION_NOT_FOR_UI');
        for (const width of [1440, 768, 390, 320]) { await root.setViewportSize({ width, height: 1000 }); await checkSurface(root, `isolated/${locale}/${theme}/${width}`); renders++; }
        const button = root.locator('.sl-fallback button'); await button.focus(); await root.keyboard.press('Enter');
        await expect.poll(() => root.evaluate(() => window.__retries)).toBe(1); interactions++;
        await expect(root.locator('.sl-fallback-actions a')).toHaveAttribute('href', locale === 'en' ? '/' : `/${locale}`);
        if (blocked && routed) await root.screenshot({ path: join(output, `isolated-${locale}-${theme}.png`) });
        assert.deepEqual(isolatedErrors, []); assert.deepEqual(unexpected, []);
        isolatedDocuments++; await isolated.close();
      }
      console.log(`PASS fallbacks ${locale}/${theme}`);
    }
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ renders, loadingInspections, interactions, isolatedDocuments, screenshots: output }, null, 2));
