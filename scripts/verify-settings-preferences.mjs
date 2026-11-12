import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-settings-preferences-'));
const browser = await chromium.launch({ headless: true });
const messages = Object.fromEntries(await Promise.all(['en', 'ko', 'ja'].map(async locale => [locale, JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8')).appSettings])));
const labels = { en: 'English', ko: '한국어', ja: '日本語' };
let renders = 0, interactions = 0;
const controlsOnly = process.argv.includes('--controls');
const requestedLocale = process.argv.find(value => value.startsWith('--locale='))?.slice('--locale='.length);
assert(!requestedLocale || ['en', 'ko', 'ja'].includes(requestedLocale), 'Use --locale=en, ko or ja');
const locales = requestedLocale ? [requestedLocale] : ['en', 'ko', 'ja'];
try {
  for (const locale of locales) for (const theme of ['light', 'dark']) {
    const t = messages[locale];
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Seoul', reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    const errors = [], mutations = [];
    await context.route('**/*', route => {
      const request = route.request(), url = request.url();
      if (url.startsWith(base) && !['GET', 'HEAD'].includes(request.method())) { mutations.push(url); return route.abort(); }
      if (url.startsWith(base + '/api/jobs/active')) return route.fulfill({ json: { jobs: [] } });
      if (url.startsWith(base) && new URL(url).pathname.startsWith('/api/')) { mutations.push(url); return route.abort(); }
      if (!url.startsWith(base) && !url.startsWith('https://fonts.')) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (/MISSING_MESSAGE|INVALID_MESSAGE|Encountered two children/.test(m.text())) errors.push(m.text()); });
    const section = key => page.locator(`[data-setting="${key}"]`);
    const log = async () => JSON.parse(await page.locator('[data-settings-calls]').textContent());
    const count = async action => (await log()).filter(call => call.action === action).length;
    const targetLocale = { en: 'ko', ko: 'ja', ja: 'en' }[locale];
    const visit = async mode => {
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
      const response = await page.goto(`${base}/dev/settings?view=preferences&mode=${mode}`);
      assert.equal(response.status(), 200, mode);
      await page.evaluate(() => document.fonts.ready);
      await page.locator('[data-settings-ready="true"]').waitFor();
    };
    async function fit(label, widths = [1440, 768, 390, 320]) {
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1000 });
        try {
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        } catch (error) { throw new Error(`${locale}/${theme}/${label}/${width}: ${error.message}`); }
        await expect.poll(() => page.locator('[data-setting]').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.dataset.setting))).toEqual([]);
        renders++;
      }
    }
    async function chooseLanguage(next, text = t) {
      const trigger = section('language').getByRole('button', { name: text.language.label, exact: true });
      await trigger.focus(); await trigger.press('Enter');
      await page.getByRole('option', { name: labels[next], exact: true }).click();
      return trigger;
    }
    if (!controlsOnly) {
    for (const mode of ['success', 'failure', 'throw', 'malformed', 'unconfigured', 'viewer', 'migration', 'migration-response', 'long', 'refresh-failure', 'display-failure', 'pending']) {
      await visit(mode); await fit(`initial-${mode}`);
      await expect(section('danger').locator('[inert]')).toHaveCount(1);
      await expect(section('language').getByRole('button', { name: t.language.label, exact: true })).toContainText(labels[locale]);
      if (mode === 'viewer') {
        await expect(section('org').getByRole('textbox', { name: t.orgInfo.nameLabel })).toHaveAttribute('readonly', '');
        await expect(section('org').getByRole('button')).toHaveCount(0);
        await expect(section('timezone').getByRole('button', { name: t.timezone.label, exact: true })).toBeDisabled();
        await expect(section('weekly')).toHaveCount(0);
        await expect(section('email').getByRole('checkbox').first()).toBeEnabled();
      }
      if (mode === 'migration') {
        await expect(section('timezone').getByRole('button', { name: t.timezone.label, exact: true })).toBeDisabled();
        await expect(section('timezone')).toContainText(t.timezone.pendingMigration);
      }
      if (mode === 'success' && locale === 'en') await page.screenshot({ path: join(output, `${theme}-initial-320.png`), fullPage: true });
    }

    for (const mode of ['success', 'failure', 'throw', 'malformed', 'unconfigured']) {
      await visit(mode);
      const failed = mode !== 'success';
      for (const key of ['org', 'timezone', 'weekly', 'digest', 'alert', 'lifecycle', 'language']) {
        await page.getByRole('button', { name: 'Reset sample responses', exact: true }).click();
        const region = section(['digest', 'alert', 'lifecycle'].includes(key) ? 'email' : key);
        const action = { org: 'rename', timezone: 'timezone', weekly: 'weekly', language: 'locale' }[key] || 'email';
        const beforeCalls = await count(action);
        let control, beforeChecked;
        if (key === 'org') {
          await region.getByRole('textbox', { name: t.orgInfo.nameLabel }).fill('  Sample edited workspace  ');
          control = region.getByRole('button', { name: t.orgInfo.save, exact: true });
          await control.focus(); await control.press('Enter');
        } else if (key === 'timezone') {
          await region.getByRole('button', { name: t.timezone.useBrowser, exact: true }).click();
          control = region.getByRole('button', { name: t.timezone.save, exact: true });
          await control.focus(); await control.press('Enter');
        } else if (key === 'language') control = await chooseLanguage(targetLocale);
        else {
          control = region.getByRole('checkbox', { name: key === 'weekly' ? t.weeklyDigest.toggle : t.emailPrefs[key], exact: true });
          beforeChecked = await control.isChecked(); await control.focus(); await control.press('Space');
        }
        if (key === 'org' || key === 'timezone') control = region.locator('button.dx-btn');
        await expect(control).toBeDisabled();
        await expect.poll(() => count(action)).toBe(beforeCalls + 1);
        const submitted = (await log()).filter(call => call.action === action).at(-1);
        const expectedPayload = key === 'org' ? '  Sample edited workspace  ' : key === 'timezone' ? 'Asia/Seoul'
          : key === 'language' ? targetLocale : key === 'weekly' ? !beforeChecked : { [key + 'OptOut']: beforeChecked };
        assert.deepEqual(submitted, { action, orgId: 'sample-workspace-a', payload: expectedPayload });
        await expect(region.locator('[data-save-notice]')).toBeVisible();
        if (failed) {
          await expect(region.getByRole('alert')).toBeVisible();
          if (key === 'language') await expect(region.getByRole('alert')).toContainText(t.language.profileFailed);
          else if (['throw', 'malformed'].includes(mode)) await expect(region.getByRole('alert')).toContainText(t.save.unconfirmed);
          else if (mode === 'failure') await expect(region.getByRole('alert')).toContainText('Sample settings error.');
          if (key === 'org') await expect(region.getByRole('textbox', { name: t.orgInfo.nameLabel })).toHaveValue('  Sample edited workspace  ');
          if (key === 'timezone') await expect(region.getByRole('button', { name: t.timezone.label, exact: true })).toContainText('Asia/Seoul');
          if (beforeChecked !== undefined) await expect(control).toBeChecked({ checked: beforeChecked });
          await fit(`${mode}-${key}-error`, [1440, 320]);
          if (locale === 'en' && mode === 'failure' && key === 'language') await page.screenshot({ path: join(output, `${theme}-language-error-320.png`), fullPage: true });
          await page.getByRole('button', { name: 'Restore sample responses', exact: true }).click();
          if (key === 'language') {
            const displays = await count('display');
            const retry = region.getByRole('button', { name: t.language.retry, exact: true });
            await retry.focus(); await retry.press('Enter');
            await expect.poll(() => count('display')).toBe(displays);
          } else { await control.focus(); await control.press(beforeChecked !== undefined ? 'Space' : 'Enter'); }
          await expect.poll(() => count(action)).toBe(beforeCalls + 2);
          await expect(region.getByRole('alert')).toHaveCount(0);
        }
        const savedText = key === 'org' ? t.orgInfo.renamed : key === 'timezone' ? t.timezone.saved : key === 'weekly' ? t.weeklyDigest.saved : key === 'language' ? t.language.saved : t.emailPrefs.saved;
        await expect(region.getByRole('status')).toHaveText(savedText);
        if (key === 'org') { await expect(region.getByRole('textbox', { name: t.orgInfo.nameLabel })).toHaveValue('Sample edited workspace'); await expect(control).toBeDisabled(); }
        if (key === 'timezone') await expect(control).toBeDisabled();
        if (beforeChecked !== undefined) await expect(control).toBeChecked({ checked: !beforeChecked });
        await expect.poll(() => region.evaluate(el => el.contains(document.activeElement))).toBe(true);
        await fit(`${mode}-${key}-saved`, [1440, 320]);
        interactions += failed ? 3 : 2;
      }
    }
    await visit('migration-response');
    await section('timezone').getByRole('button', { name: t.timezone.useBrowser, exact: true }).click();
    await section('timezone').getByRole('button', { name: t.timezone.save, exact: true }).click();
    await expect(section('timezone').getByRole('status')).toHaveText(t.timezone.pendingMigration);
    await expect(section('timezone').getByRole('alert')).toHaveCount(0);
    await expect(section('timezone').getByRole('button', { name: t.timezone.label, exact: true })).toBeDisabled();
    await fit('migration-response'); interactions++;

    await visit('refresh-failure');
    await section('org').getByRole('textbox', { name: t.orgInfo.nameLabel }).fill('Confirmed sample');
    await section('org').getByRole('button', { name: t.orgInfo.save, exact: true }).click();
    await expect(section('org').getByRole('status')).toHaveText(t.orgInfo.renamed);
    await expect(section('org').getByRole('alert')).toHaveCount(0); interactions++;

    await visit('display-failure'); await chooseLanguage(targetLocale);
    await expect(section('language').getByRole('alert')).toContainText(t.language.displayFailed);
    assert.equal(await count('locale'), 0); await fit('display-failure'); interactions++;

    // Deliberately held local responses prove pending layouts and workspace isolation.
    await visit('pending');
    await section('org').getByRole('textbox', { name: t.orgInfo.nameLabel }).fill('Old workspace pending draft');
    await section('org').getByRole('button', { name: t.orgInfo.save, exact: true }).click();
    await section('timezone').getByRole('button', { name: t.timezone.useBrowser, exact: true }).click();
    await section('timezone').getByRole('button', { name: t.timezone.save, exact: true }).click();
    await section('weekly').getByRole('checkbox').click();
    await section('email').getByRole('checkbox').first().click();
    await chooseLanguage(targetLocale);
    await expect(page.locator('[data-setting] [role="status"]')).toHaveCount(5);
    await fit('pending');
    await page.getByRole('button', { name: 'Switch sample workspace', exact: true }).click();
    await expect(section('org').getByRole('textbox', { name: t.orgInfo.nameLabel })).toHaveValue('Other sample workspace');
    await page.getByRole('button', { name: 'Release pending responses', exact: true }).click();
    await page.waitForTimeout(700);
    await expect(page.locator('[data-save-notice]')).toHaveCount(0);
    await expect(section('org').getByRole('textbox', { name: t.orgInfo.nameLabel })).toHaveValue('Other sample workspace');
    await expect(section('timezone').getByRole('button', { name: t.timezone.label, exact: true })).toHaveText('UTC (UTC)');
    await expect(section('weekly').getByRole('checkbox')).not.toBeChecked();
    interactions += 7;

    // Real local cookie/refresh, but profile persistence still uses the fake action.
    for (const mode of ['locale-live', 'locale-live-failure']) {
      await visit(mode); await chooseLanguage(targetLocale);
      const next = messages[targetLocale];
      await expect(page.locator('html')).toHaveAttribute('lang', targetLocale);
      assert.equal((await context.cookies()).find(cookie => cookie.name === 'NEXT_LOCALE')?.value, targetLocale);
      const language = section('language');
      if (mode === 'locale-live-failure') {
        await expect(language.getByRole('alert')).toContainText(next.language.profileFailed);
        await page.getByRole('button', { name: 'Restore sample responses', exact: true }).click();
        await language.getByRole('button', { name: next.language.retry, exact: true }).click();
        await expect.poll(() => count('locale')).toBe(2);
      }
      await expect(language.getByRole('status')).toHaveText(next.language.saved);
      assert.equal(await count('display'), 1);
      await fit(mode); interactions += mode === 'locale-live' ? 2 : 3;
    }
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    for (const role of ['owner', 'viewer']) {
      assert.equal((await page.goto(`${base}/dev/settings?view=workspace&role=${role}`)).status(), 200);
      await fit(`shell-${role}`);
      await expect(section('language')).toHaveCount(1);
      await expect(section('weekly')).toHaveCount(role === 'owner' ? 1 : 0);
    }
    }

    // Short-mobile keyboard coverage for the actual 400+ option timezone control.
    await visit('success');
    await page.setViewportSize({ width: 320, height: 640 });
    await expect(section('email')).toContainText(t.emailPrefs.desc);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const zone = section('timezone').getByRole('button', { name: t.timezone.label, exact: true });
    await zone.focus(); await zone.press('Enter');
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    assert.ok(await listbox.getByRole('option').count() > 100);
    await page.keyboard.press('End');
    await expect(listbox.getByRole('option').last().locator('button')).toBeFocused();
    const box = await listbox.boundingBox();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 321 && box.y + box.height <= 641, 'Timezone popup stays in the short viewport');
    renders++;
    await page.keyboard.press('Escape'); await expect(zone).toBeFocused();
    await zone.press('Enter'); await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await expect(listbox).toHaveCount(0); await expect(zone).toBeFocused();
    await expect(section('timezone').getByRole('button', { name: t.timezone.save, exact: true })).toBeEnabled();
    assert.equal((await log()).length, 0, 'Selecting a timezone only edits a draft');
    renders++; interactions += 8;
    if (locale === 'en') await page.screenshot({ path: join(output, theme + '-short-controls.png'), fullPage: true });

    // Completing a pending save must not steal focus from a different setting.
    await visit('pending'); await page.setViewportSize({ width: 320, height: 640 });
    await section('org').getByRole('textbox', { name: t.orgInfo.nameLabel }).fill('Pending focus check');
    const orgSave = section('org').getByRole('button', { name: t.orgInfo.save, exact: true });
    await orgSave.focus(); await orgSave.press('Enter');
    await expect(section('org').locator('button.dx-btn')).toBeDisabled();
    const otherControl = section('timezone').getByRole('button', { name: t.timezone.label, exact: true });
    await otherControl.focus();
    await page.getByRole('button', { name: 'Release pending responses', exact: true }).evaluate(button => button.click());
    await expect(section('org').getByRole('status')).toHaveText(t.orgInfo.renamed);
    await expect(otherControl).toBeFocused();
    assert.equal(await count('rename'), 1);
    renders++; interactions += 2;

    await visit('migration'); await page.setViewportSize({ width: 320, height: 640 });
    const migrationZone = section('timezone').getByRole('button', { name: t.timezone.label, exact: true });
    await expect(migrationZone).toBeDisabled();
    await page.getByRole('button', { name: 'Apply sample timezone migration', exact: true }).click();
    await expect(migrationZone).toBeEnabled();
    await expect(section('timezone').getByText(t.timezone.pendingMigration, { exact: true })).toHaveCount(0);
    await section('timezone').getByRole('button', { name: t.timezone.useBrowser, exact: true }).click();
    await section('timezone').getByRole('button', { name: t.timezone.save, exact: true }).click();
    await expect(section('timezone').getByRole('status')).toHaveText(t.timezone.saved);
    renders++; interactions += 2;
    assert.deepEqual(errors, []); assert.deepEqual(mutations, []);
    console.log(`PASS ${locale}/${theme}`);
    await context.close();
  }
  console.log(JSON.stringify({ locales, controlsOnly, viewportCases: renders, localInteractions: interactions, output }));
} finally { await browser.close(); }
