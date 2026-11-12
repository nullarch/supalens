/** Actual shell; account writes blocked and job polling fulfilled with sample data. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';

const baseURL = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Local design fixture only');
const output = await mkdtemp(join(tmpdir(), 'supalens-navigation-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let cases = 0;

async function fits(page) {
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1);
}

try {
  for (const locale of ['en', 'ko', 'ja']) {
    const m = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const t = m.appChrome;
    for (const theme of ['light', 'dark']) {
      for (const width of [1440, 900, 390, 320]) {
        const context = await browser.newContext({ viewport: { width, height: 720 }, reducedMotion: 'reduce' });
        context.setDefaultTimeout(10000);
        const mutations = [], errors = [];
        let jobs = [
          { id: 'sample-kpi', kind: 'kpi', detail: 'Northstar international product operations', startedAt: new Date(Date.now() - 120000).toISOString(), stale: false, href: '#preview-content' },
          { id: 'sample-context', kind: 'context', detail: 'Business rules / subscription entitlements', startedAt: new Date(Date.now() - 1500000).toISOString(), stale: true, href: '#preview-content' },
        ];
        await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: baseURL }]);
        await context.addInitScript(value => localStorage.setItem('theme', value), theme);
        await context.route('**/*', route => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.origin !== new URL(baseURL).origin && !/^(fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net)$/.test(url.hostname)) return route.abort();
          if (request.url().startsWith(baseURL) && !['GET', 'HEAD'].includes(request.method())) {
            mutations.push(request.method());
            return route.abort();
          }
          if (request.url().startsWith(`${baseURL}/api/jobs/active`)) return route.fulfill({ json: { jobs } });
          if (url.origin === new URL(baseURL).origin && url.pathname.startsWith('/api/')) {
            mutations.push(`Unexpected API read ${url.pathname}`); return route.abort();
          }
          return route.continue();
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
          if (/MISSING_MESSAGE|INVALID_MESSAGE|requires a `DialogTitle`|Missing `Description`/.test(message.text())) errors.push(message.text());
        });
        assert.equal((await page.goto(`${baseURL}/dev/chrome`)).status(), 200);
        await page.evaluate(() => document.fonts.ready);
        await fits(page);
        // A modal drawer correctly hides its background from the accessibility tree.
        const menuButton = page.getByRole('button', { name: t.topbar.menu, exact: true, includeHidden: true });
        const nav = page.getByRole('navigation', { name: t.navigation, exact: true });
        const drawer = page.getByRole('dialog', { name: t.navigation, exact: true });

        if (width <= 900) {
          await expect(nav).toHaveCount(0);
          await menuButton.focus();
          await page.keyboard.press('Tab');
          assert.equal(await page.evaluate(() => !!document.activeElement?.closest('aside')), false, 'Closed navigation not tabbable');
          await menuButton.click();
          await expect(drawer).toBeVisible();
          await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
          assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden');
          for (let i = 0; i < 22; i++) {
            await page.keyboard.press(i < 11 ? 'Tab' : 'Shift+Tab');
            assert.equal(await drawer.evaluate(el => el.contains(document.activeElement)), true, 'Focus stays inside drawer');
          }
        } else {
          await expect(nav).toBeVisible();
          await expect(menuButton).toBeHidden();
        }

        const orgButton = page.locator('aside button[aria-haspopup="menu"]');
        await orgButton.focus();
        await page.keyboard.press('ArrowDown');
        const orgMenu = page.getByRole('menu', { name: t.account.menu, exact: true });
        await expect(orgMenu.getByRole('menuitemradio').first()).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(orgMenu.getByRole('menuitemradio').nth(1)).toBeFocused();
        await page.keyboard.press('End');
        await expect(orgMenu.getByRole('menuitem', { name: t.user.signout, exact: true })).toBeFocused();
        await page.keyboard.press('Home');
        await expect(orgMenu.getByRole('menuitemradio').first()).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(orgMenu).toBeHidden();
        await expect(orgButton).toBeFocused();
        if (width <= 900) await expect(drawer).toBeVisible();

        await orgButton.click();
        await orgMenu.getByRole('menuitem', { name: t.org.new, exact: true }).click();
        const create = page.getByRole('dialog', { name: t.org.createTitle, exact: true });
        await expect(create).toBeVisible();
        await expect(create.getByRole('button', { name: t.common.create, exact: true })).toBeDisabled();
        const box = await create.boundingBox();
        assert.ok(box.x >= 15 && box.x + box.width <= width - 15);
        await create.getByLabel(t.org.namePlaceholder, { exact: true }).fill('Sample only — do not submit');
        await page.keyboard.press('Escape');
        await expect(create).toBeHidden();
        await expect(orgButton).toBeFocused();
        if (width <= 900) await expect(drawer).toBeVisible();

        // Dashboards (Mixpanel's boards list): right under home, every board at once, the home board
        // tagged, closed by "All dashboards"; the "+" beside the label opens the create dialog.
        const boardsSection = page.locator('aside [data-boards]');
        const boardLinks = boardsSection.locator('a[data-board]');
        assert.deepEqual(await boardLinks.evaluateAll(els => els.map(el => el.getAttribute('href'))),
          ['/app/dashboards/core-kpi', '/app/dashboards/weekly', '/app/dashboards/billing-health']);
        await expect(boardLinks.first().locator('[class*="boardHome"]')).toHaveText(t.boards.home);
        await expect(boardLinks.nth(1).locator('[class*="boardHome"]')).toHaveCount(0);
        for (const board of await boardLinks.all()) {
          const row = await board.evaluate(el => ({ height: el.getBoundingClientRect().height, text: el.querySelector('[class*="itemText"]'), right: el.getBoundingClientRect().right, rail: el.closest('aside').getBoundingClientRect().right }));
          assert(row.height <= 32.5 && row.right <= row.rail, 'A board row stays one line inside the rail');
        }
        const hrefs = await page.locator('aside nav a').evaluateAll(els => els.map(el => el.getAttribute('href')));
        assert.deepEqual(hrefs.slice(0, 6), ['/app/overview', '/app/dashboards/core-kpi', '/app/dashboards/weekly', '/app/dashboards/billing-health', '/app/dashboards', '/app/monitors']);
        assert.equal(hrefs.filter(href => href === '/app/dashboards').length, 1, 'The index is listed once, inside the boards section');
        const addBoard = boardsSection.getByRole('button', { name: t.dashboard.createTitle, exact: true });
        const addBox = await addBoard.boundingBox();
        if (width <= 900) assert(addBox.width >= 44 && addBox.height >= 44, 'Touch-sized add button in the drawer');
        await addBoard.click();
        const boardDialog = page.getByRole('dialog', { name: t.dashboard.createTitle, exact: true });
        await expect(boardDialog).toBeVisible();
        const boardCreate = boardDialog.getByRole('button', { name: t.common.create, exact: true });
        await expect(boardCreate).toBeDisabled();
        await boardDialog.getByLabel(t.dashboard.namePlaceholder, { exact: true }).fill('Sample only — do not submit');
        await expect(boardCreate).toBeEnabled();
        const boardBox = await boardDialog.boundingBox();
        assert.ok(boardBox.x >= 15 && boardBox.x + boardBox.width <= width - 15);
        if (locale === 'ko' && theme === 'light') await page.screenshot({ path: join(output, `board-create-${width}.png`) });
        await page.keyboard.press('Escape');
        await expect(boardDialog).toBeHidden();
        await expect(addBoard).toBeFocused();
        if (width <= 900) await expect(drawer).toBeVisible();

        // Settings is ONE row: its sections moved into the settings sub-nav, so the rail never
        // carries six configuration links above the work the product is for.
        await expect(nav.getByRole('link', { name: t.nav.settings, exact: true })).toHaveCount(1);
        for (const name of [t.nav.settingsNotifications, t.nav.settingsTeam, t.nav.settingsBilling, t.nav.settingsDeveloper, t.nav.settingsIntegrations]) {
          await expect(nav.getByRole('link', { name, exact: true })).toHaveCount(0);
        }
        // Monitors and incidents are one destination; business model is reached from a source.
        await expect(nav.getByRole('link', { name: t.nav.watch, exact: true })).toHaveCount(1);
        for (const name of [t.nav.incidents, t.nav.businessModel]) {
          await expect(nav.getByRole('link', { name, exact: true })).toHaveCount(0);
        }

        if (width > 900) {
          // Collapsible rail: 240px ↔ 56px, names stay accessible, choice persists.
          const rail = page.locator('aside');
          await page.getByRole('button', { name: t.sidebar.collapse, exact: true }).click();
          await expect.poll(() => rail.evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(56);
          await expect(nav.getByRole('link', { name: t.nav.watch, exact: true })).toBeVisible();
          // The icon rail keeps "All dashboards" and drops the board rows and the "+".
          await expect(nav.getByRole('link', { name: t.nav.allDashboards, exact: true })).toBeVisible();
          await expect(page.locator('aside a[data-board]').first()).toBeHidden();
          await expect(page.locator('aside [data-boards] button')).toBeHidden();
          await fits(page);
          if (locale === 'en') await page.screenshot({ path: join(output, `collapsed-${theme}-${width}.png`) });
          await page.reload();
          await expect.poll(() => page.evaluate(() => document.documentElement.dataset.sidebar), { message: 'Collapsed rail persists across reloads' }).toBe('collapsed');
          await page.getByRole('button', { name: t.sidebar.expand, exact: true }).click();
          await expect.poll(() => rail.evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(240);
        }

        if (width <= 900) {
          if (locale === 'en') await page.screenshot({ path: join(output, `drawer-${theme}-${width}.png`) });
          await page.keyboard.press('Escape');
          await expect(drawer).toBeHidden();
          await expect(menuButton).toBeFocused();
          assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden');
          await menuButton.click();
          await page.locator('[class*="drawerOverlay"]').click({ position: { x: width - 10, y: 180 } });
          await expect(drawer).toBeHidden();
          await expect(menuButton).toBeFocused();
          await menuButton.click();
          await drawer.getByRole('button', { name: m.appCommon.close, exact: true }).click();
          await expect(menuButton).toBeFocused();
          // Opening a drawer and crossing the breakpoint must unlock the page.
          await menuButton.click();
          await page.setViewportSize({ width: 1440, height: 720 });
          await expect(nav).toBeVisible();
          await expect(drawer).toHaveCount(0);
          assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden');
          await page.setViewportSize({ width, height: 720 });
          await expect(nav).toHaveCount(0);
        }

        const jobsButton = page.locator('[data-jobs] button[aria-haspopup="dialog"]');
        await expect(jobsButton).toBeVisible();
        await jobsButton.click();
        const pop = page.locator('[data-jobs] [role="dialog"]');
        await expect(pop.getByRole('link').first()).toBeFocused();
        const popBox = await pop.boundingBox();
        assert.ok(popBox.x >= 15 && popBox.x + popBox.width <= width - 15, 'Activity popover within horizontal gutters');
        await fits(page);
        if (locale === 'en') await page.screenshot({ path: join(output, `activity-${theme}-${width}.png`) });
        await page.keyboard.press('Escape');
        await expect(pop).toBeHidden();
        await expect(jobsButton).toBeFocused();
        await jobsButton.click();
        await expect(pop).toBeVisible();
        await page.mouse.click(width - 10, 500);
        await expect(pop).toBeHidden();

        if (width === 320) {
          // Exercise the existing disappearance/finished branch with a sample poll.
          jobs = [];
          await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
          await expect(jobsButton).toHaveAttribute('aria-label', t.jobs.justEnded);
          await jobsButton.click();
          await expect(pop).toHaveAttribute('aria-label', t.jobs.justEnded);
          await expect(pop.getByRole('link')).toHaveCount(2);
          assert.equal((await pop.innerText()).includes('✓'), false, 'Ended does not claim success');
          await page.keyboard.press('Escape');
        }

        assert.deepEqual(errors, [], 'No runtime, localization or dialog accessibility warnings');
        assert.deepEqual(mutations, [], 'No account/server mutation attempted');
        await context.close();
        cases++;
        console.log(`PASS ${locale}/${theme}/${width}: drawer, nested org modal, keyboard, activity, viewport`);
      }
    }
  }
  const resizeContext = await browser.newContext({ viewport: { width: 1440, height: 720 }, reducedMotion: 'reduce' });
  resizeContext.setDefaultTimeout(10000);
  await resizeContext.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin && !/^(fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net)$/.test(url.hostname)) return route.abort();
    if (request.url().startsWith(baseURL) && !['GET', 'HEAD'].includes(request.method())) throw new Error('Unexpected mutation in resize check');
    if (request.url().startsWith(`${baseURL}/api/jobs/active`)) return route.fulfill({ json: { jobs: [] } });
    if (url.origin === new URL(baseURL).origin && url.pathname.startsWith('/api/')) throw new Error(`Unexpected API read ${url.pathname}`);
    return route.continue();
  });
  const resizePage = await resizeContext.newPage();
  await resizePage.goto(`${baseURL}/dev/chrome`);
  await resizePage.locator('aside button[aria-haspopup="menu"]').click();
  await resizePage.getByRole('menuitem', { name: 'New organization', exact: true }).click();
  await resizePage.getByLabel('Organization name', { exact: true }).fill('Draft survives resize');
  await resizePage.setViewportSize({ width: 320, height: 720 });
  await expect(resizePage.getByLabel('Organization name', { exact: true })).toHaveValue('Draft survives resize');
  await expect(resizePage.getByRole('dialog', { name: 'Create organization', exact: true })).toBeVisible();
  await resizePage.keyboard.press('Escape');
  await expect(resizePage.getByRole('dialog')).toHaveCount(0);
  await resizeContext.close();
  const ssrContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 720 } });
  const ssrPage = await ssrContext.newPage();
  await ssrPage.goto(`${baseURL}/dev/chrome`);
  await expect(ssrPage.getByRole('navigation')).toHaveCount(0);
  await ssrContext.close();
  console.log('PASS draft preservation across breakpoint and pre-hydration hidden navigation');
} finally {
  await browser.close();
  console.log(`Checked ${cases} navigation interaction cases. Screenshots: ${output}`);
}
