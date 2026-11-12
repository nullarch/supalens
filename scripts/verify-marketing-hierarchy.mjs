/** Read-only rendering checks for the public marketing typography pass.
 * No demo query, authentication, delivery or account action is executed.
 * Usage: node scripts/verify-marketing-hierarchy.mjs http://localhost:3107
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
const origin = new URL(base).origin;
const output = await mkdtemp(join(tmpdir(), 'supalens-marketing-hierarchy-'));
const browser = await chromium.launch({ headless: true });
let viewportChecks = 0, typographyChecks = 0, keyboardChecks = 0;
const errors = [], mutations = [];
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin && !/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.hostname)) return route.abort();
      if (url.origin === origin && (!['GET', 'HEAD'].includes(request.method()) || url.pathname.startsWith('/api/'))) {
        mutations.push(request.method() + ' ' + url.pathname); return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    for (const locale of ['en', 'ko', 'ja']) {
      const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: origin }]);
      for (const route of ['/', '/supabase', '/privacy']) {
        const pathname = locale === 'en' ? route : `/${locale}${route === '/' ? '' : route}`;
        assert.equal((await page.goto(base + pathname)).status(), 200);
        await page.evaluate(() => document.fonts.ready);
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          // Viewport-unit spacing (clamp(…vw…)) settles a frame after the resize.
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
          if (route !== '/privacy') {
            const preview = page.getByRole('group', { name: messages.globalProduct.previewLabel, exact: true });
            await expect(preview).toBeVisible();
            await expect(preview.getByText(messages.alertDemo.slack.alertTitle, { exact: true })).toBeVisible();
            assert.equal(await preview.locator('[aria-hidden="true"]').filter({ hasText: messages.alertDemo.confirmedTag }).count(), 0);
          }
          const inspection = await page.evaluate(route => {
            const problems = []; let inspected = 0;
            const roots = route === '/supabase'
              ? document.querySelectorAll('section[aria-labelledby="hero-title"], #after-connect, #why-code, #how, #monitoring')
              : document.querySelectorAll('section[aria-labelledby="hero-title"], #monitoring, #security, footer');
            for (const root of roots) for (const node of root.querySelectorAll('*')) {
              if (node.children.length || !node.textContent.trim() || node.closest('svg, pre, code, [aria-hidden="true"]')) continue;
              const style = getComputedStyle(node), box = node.getBoundingClientRect();
              if (!box.width || !box.height || style.display === 'none') continue;
              const technicalPath = /Security/.test(node.className) && /chip/.test(node.className)
                // Editorial pages (home, /supabase): mono is the label voice (tags, kickers, captions,
                // the hero's "Connects to" label).
                || route !== '/privacy' && !!node.closest('.ed-tag, [class*="kicker"], [class*="caption"], [class*="connectsLabel"]');
              if (/mono|Plex/i.test(style.fontFamily) && !technicalPath) problems.push(`Unexpected mono: ${node.textContent.slice(0, 60)}`);
              const minimum = /appBadge/.test(node.className) ? 11 : 12;
              if (parseFloat(style.fontSize) < minimum) problems.push(`Small ${style.fontSize}: ${node.textContent.slice(0, 60)}`);
              // Internal hidden containers must not silently crop readable copy.
              const range = document.createRange(); range.selectNodeContents(node);
              for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement) {
                const parentStyle = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
                if (['hidden', 'clip'].includes(parentStyle.overflowX)) {
                  for (const rect of range.getClientRects()) if (rect.width > 1 && (rect.left < bounds.left - 2 || rect.right > bounds.right + 2)) {
                    problems.push(`Clipped text: ${node.textContent.slice(0, 60)}`); break;
                  }
                }
              }
              inspected++;
            }
            if (route === '/supabase') {
              const h1 = document.querySelector('h1');
              if (parseFloat(getComputedStyle(h1).fontSize) < 36) problems.push('Intro heading hierarchy');
              // Editorial buttons keep the reference's 10px radius.
              for (const node of document.querySelectorAll('main .ed-button')) {
                if (getComputedStyle(node).borderTopLeftRadius !== '10px') problems.push('Nonstandard control radius');
              }
              if (/\bLIVE\b/.test(document.querySelector('#how').innerText)) problems.push('Static example claims LIVE');
            }
            for (const node of document.querySelectorAll('[class*="SignalDemo"][class*="dot"]')) {
              if (getComputedStyle(node).animationName !== 'none') problems.push('Animated sample status');
            }
            return { problems, inspected };
          }, route);
          assert.deepEqual(inspection.problems, [], `${locale} ${theme} ${route} ${width}`);
          typographyChecks += inspection.inspected; viewportChecks++;
          if (route === '/supabase') {
            for (const pre of await page.locator('#why-code pre').all()) {
              await pre.focus(); await expect(pre).toBeFocused(); keyboardChecks++;
              if (await pre.evaluate(node => node.scrollWidth > node.clientWidth + 1)) {
                await pre.evaluate(node => { node.scrollLeft = 0; });
                await pre.press('ArrowRight');
                await expect.poll(() => pre.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
                keyboardChecks++;
              }
            }
          }
          if (route === '/privacy') await expect(page.getByRole('navigation', { name: messages.legal.toc })).toHaveCSS('border-top-left-radius', '8px');
        }
        if (route === '/supabase') {
          await page.setViewportSize({ width: 1440, height: 1000 }); await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({ path: join(output, `intro-${locale}-${theme}.png`) });
          await page.locator('#monitoring').scrollIntoViewIfNeeded();
          await page.screenshot({ path: join(output, `alerts-${locale}-${theme}.png`), fullPage: false });
        }
      }
    }
    await context.close(); console.log(`PASS ${theme}`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(mutations, []);
  console.log(JSON.stringify({ viewportChecks, typographyChecks, keyboardChecks, output }));
} finally { await browser.close(); }
