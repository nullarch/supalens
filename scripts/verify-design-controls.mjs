/** Shared production controls with local-state fixture callbacks only.
 * Usage: node scripts/verify-design-controls.mjs http://localhost:3107
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseURL = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Local design fixture only');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let checks = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) {
    const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ reducedMotion: 'reduce' });
      const mutations = [];
      await context.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== new URL(baseURL).origin && !/^(fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net)$/.test(url.hostname)) return route.abort();
        if (request.url().startsWith(baseURL) && !['GET', 'HEAD'].includes(request.method())) {
          mutations.push(`${request.method()} ${request.url()}`);
          return route.abort();
        }
        if (url.origin === new URL(baseURL).origin && url.pathname === '/api/jobs/active') return route.fulfill({ json: { jobs: [] } });
        if (url.origin === new URL(baseURL).origin && url.pathname.startsWith('/api/')) {
          mutations.push(`Unexpected API read ${url.pathname}`); return route.abort();
        }
        return route.continue();
      });
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: baseURL }]);
      await context.addInitScript(value => localStorage.setItem('theme', value), theme);
      const page = await context.newPage();
      for (const width of [1440, 768, 320]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`${baseURL}/dev/settings?view=controls`, { waitUntil: 'domcontentloaded' });
        const opener = page.getByRole('button', { name: 'Open form preview', exact: true });
        await opener.click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible' });
        const box = await dialog.boundingBox();
        assert.ok(box.x >= 15 && box.x + box.width <= width - 15, 'Dialog has mobile gutters');
        assert.ok(box.y >= 15 && box.y + box.height <= 785, 'Dialog stays within viewport');
        const input = dialog.getByLabel('Workspace name');
        await input.fill('Orbit');
        const select = dialog.getByRole('button', { name: 'Timezone', exact: true });
        await select.focus();
        await page.keyboard.press('ArrowDown');
        await page.getByRole('listbox').waitFor({ state: 'visible' });
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        assert.match(await select.innerText(), /Los Angeles/);
        await select.click();
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('listbox').count(), 0, 'Escape closes dropdown');
        assert.equal(await dialog.count(), 1, 'Dropdown Escape keeps dialog open');
        await dialog.getByRole('button', { name: messages.appCommon.confirm, exact: true }).click();
        assert.match(await page.getByRole('status').last().innerText(), /Orbit.*America\/Los_Angeles/);
        await opener.click();
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        // Radix restores focus after its exit/unmount cleanup, not synchronously
        // with the element becoming hidden.
        await page.waitForFunction(() => document.activeElement?.textContent === 'Open form preview', undefined, { timeout: 1500 });
        assert.equal(await opener.evaluate(el => el === document.activeElement), true, 'Focus returns to opener');
        await opener.click();
        await dialog.getByRole('button', { name: messages.appCommon.close, exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: 'Open confirmation preview', exact: true }).click();
        await dialog.getByRole('button', { name: messages.appCommon.cancel, exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(await page.getByRole('button', { name: 'Disabled action', exact: true }).isDisabled(), true);
        checks++;
      }
      await page.goto(`${baseURL}/dev/settings?view=plans`, { waitUntil: 'domcontentloaded' });
      const yearly = page.getByRole('button', { name: messages.appBilling.planCards.yearly, exact: true });
      await yearly.click();
      assert.equal(await yearly.getAttribute('aria-pressed'), 'true');
      assert.deepEqual(mutations, [], 'No server mutation was attempted');
      await context.close();
      console.log(`PASS ${locale} ${theme}: modal gutters, selection, Escape, focus return, localized close, disabled action, billing interval`);
    }
  }
  console.log(`PASS ${checks} shared-control interaction cases; no server mutations.`);
} finally {
  await browser.close();
}
