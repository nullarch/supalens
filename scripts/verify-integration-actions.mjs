import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { localFixtureOrigin, guardDesignFixture, assertControlTargets } from './lib/design-fixture.mjs';

const base = localFixtureOrigin(process.argv[2]);
const output = await mkdtemp(join(tmpdir(), 'supalens-integration-actions-'));
const browser = await chromium.launch({ headless: true });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    console.log(`Checking integration actions: ${locale}/${theme}`);
    const { appIntegrations: t, appCommon: common } = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    const errors = [], unexpected = [];
    await guardDesignFixture(context, base, unexpected);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { errors.push('Unexpected native confirmation'); void dialog.dismiss(); });
    page.on('console', message => { if (/MISSING_MESSAGE|INVALID_MESSAGE/.test(message.text())) errors.push(message.text()); });
    const calls = async () => JSON.parse(await page.locator('[data-integration-calls]').textContent());
    const visit = async mode => {
      assert.equal((await page.goto(`${base}/dev/settings?view=integration-actions&mode=${mode}`)).status(), 200);
      await page.evaluate(() => document.fonts.ready);
    };
    const fit = async () => {
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await assertControlTargets(page, 'main button, [role="dialog"] button, [data-setting="integration-scope"] label:has(input)');
        const dialog = page.getByRole('dialog');
        if (await dialog.count()) {
          await expect.poll(() => dialog.evaluate(node => {
            const rect = node.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
          })).toBe(true);
        }
        renders++;
      }
    };
    for (const mode of ['success', 'viewer', 'unavailable', 'empty', 'unlisted', 'long']) {
      await visit(mode); await fit();
      if (mode === 'viewer') {
        await expect(page.getByRole('button', { name: t.page.disconnect, exact: true })).toHaveCount(0);
        await expect(page.getByRole('checkbox')).toHaveCount(0);
      }
      if (['unavailable', 'empty'].includes(mode)) {
        await expect(page.getByRole('status')).toHaveText(t.scopeUnavailable);
        await expect(page.getByRole('checkbox')).toHaveCount(0);
      }
      assert.deepEqual(await calls(), []);
    }
    for (const [provider, action] of [['GitHub', 'disconnect'], ['Slack', 'disconnect'], ['Supabase', 'disconnect'], ['Supabase', 'resync']]) {
      for (const mode of ['success', 'failure', 'pending', 'long']) {
        await visit(mode);
        const card = page.getByRole('region', { name: provider, exact: true });
        const label = action === 'resync' ? t.page.supabaseCard.resync : t.page.disconnect;
        const trigger = card.getByRole('button', { name: label, exact: true });
        await trigger.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText(provider);
        await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused(); assert.deepEqual(await calls(), []);
        await trigger.click(); await fit();
        if (mode === 'long' && locale === 'en' && action === 'resync') await page.screenshot({ path: join(output, `${theme}-long-dialog-320.png`), fullPage: true });
        await dialog.getByRole('button', { name: label, exact: true }).click();
        if (mode === 'pending') {
          await expect(dialog.getByRole('button', { name: common.processing, exact: true })).toBeDisabled();
          await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
          await dialog.getByRole('button', { name: common.processing, exact: true }).evaluate(button => { button.click(); button.click(); });
        }
        if (mode === 'failure') {
          await expect(dialog.getByRole('alert')).toHaveText(t.actionUnconfirmed);
          await expect(dialog.getByRole('button', { name: label, exact: true })).toBeDisabled();
          await dialog.getByRole('button', { name: common.close, exact: true }).click();
          await expect(card.getByRole('alert')).toHaveText(t.actionUnconfirmed);
        } else {
          await expect(dialog).toHaveCount(0);
          await expect(card.getByRole('status')).toHaveText(t.actionFinished);
        }
        await expect(trigger).toBeDisabled();
        await expect(card.getByRole('link', { name: t.reloadSettings, exact: true })).toHaveAttribute('href', '/dev/settings?view=integration-actions&mode=success');
        assert.deepEqual(await calls(), [{ action: action === 'resync' ? 'resync' : `disconnect-${provider}`, value: `sample-${provider}` }]);
        interactions++;
      }
    }
    for (const reset of [false, true]) for (const mode of ['success', 'failure', 'throw', 'malformed', 'pending', 'refresh-failure']) {
      await visit(mode);
      const scope = page.locator('[data-setting="integration-scope"]');
      await expect(scope).toHaveAccessibleName(t.page.slackScope.label);
      const save = scope.getByRole('button', { name: t.page.slackScope.save, exact: true });
      await expect(save).toBeDisabled();
      if (reset) await scope.getByRole('checkbox', { name: '#business-alerts', exact: true }).uncheck();
      else await scope.getByRole('checkbox', { name: '#engineering', exact: true }).check();
      await save.click();
      const dialog = page.getByRole('dialog');
      if (reset) {
        await expect(dialog).toContainText(t.scopeResetDescription);
        assert.deepEqual(await calls(), []);
        await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(save).toBeFocused();
        await save.click(); await fit();
        await dialog.getByRole('button', { name: t.scopeResetTitle, exact: true }).click();
      } else await expect(dialog).toHaveCount(0);
      if (mode === 'pending') {
        await expect(scope.locator('input[type="checkbox"]').first()).toBeDisabled();
        if (reset) { await page.keyboard.press('Escape'); await expect(dialog).toBeVisible(); }
      }
      if (['failure', 'throw', 'malformed'].includes(mode)) {
        await expect((reset ? dialog : scope).getByRole('alert')).toHaveText(mode === 'failure' ? t.page.slackScope.saveFailed : t.scopeUnconfirmed);
        if (reset) await dialog.getByRole('button', { name: common.close, exact: true }).click();
        await expect(save).toBeEnabled();
      } else {
        await expect(dialog).toHaveCount(0);
        await expect(scope.getByRole('status')).toHaveText(mode === 'refresh-failure' ? t.scopeRefreshFailed
          : reset ? t.page.slackScope.savedReset : t.page.slackScope.savedLimited.replace('{count}', '2'));
        await expect(save).toBeDisabled();
      }
      await expect(scope.getByRole('checkbox', { name: '#business-alerts', exact: true })).toBeChecked({ checked: !reset });
      assert.deepEqual(await calls(), [{ action: 'scope', value: reset ? [] : ['C1', 'C2'] }]);
      await fit(); interactions++;
    }
    await visit('unlisted');
    await page.getByRole('checkbox', { name: '#engineering', exact: true }).check();
    await page.getByRole('button', { name: t.page.slackScope.save, exact: true }).click();
    await expect(page.getByRole('status')).toBeVisible();
    assert.deepEqual(await calls(), [{ action: 'scope', value: ['C1', 'SAVED_NOT_LISTED', 'C2'] }]);
    await expect(page.getByRole('checkbox', { name: 'SAVED_NOT_LISTED', exact: true })).toBeChecked();
    interactions++;
    await visit('long'); await fit();
    await page.screenshot({ path: join(output, `${locale}-${theme}-long-320.png`), fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await context.close();
  }
  console.log(JSON.stringify({ renders, interactions, screenshots: output }));
} finally { await browser.close(); }
