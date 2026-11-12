import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { localFixtureOrigin, guardDesignFixture, assertControlTargets } from './lib/design-fixture.mjs';

const base = localFixtureOrigin(process.argv[2]);
const output = await mkdtemp(join(tmpdir(), 'supalens-mcp-settings-'));
const browser = await chromium.launch({ headless: true });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    console.log(`Checking MCP settings: ${locale}/${theme}`);
    const { appMcp: t, appCommon: common } = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    const errors = [], unexpected = [];
    await guardDesignFixture(context, base, unexpected);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', m => { if (/MISSING_MESSAGE|INVALID_MESSAGE/.test(m.text())) errors.push(m.text()); });
    const visit = async mode => {
      const response = await page.goto(`${base}/dev/settings?view=mcp-actions&mode=${mode}`);
      assert.equal(response.status(), 200);
      await page.evaluate(() => document.fonts.ready);
    };
    const calls = async () => JSON.parse(await page.locator('[data-mcp-calls]').textContent());
    const keySection = () => page.getByRole('region', { name: t.step1.heading, exact: true }).filter({ has: page.getByRole('heading', { name: t.step1.heading }) });
    const mint = () => page.getByRole('button', { name: t.step1.mint, exact: true });
    const targets = () => assertControlTargets(page, 'main button, [role="dialog"] button');
    const fit = async () => {
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await targets();
        renders++;
      }
    };
    for (const mode of ['success', 'viewer', 'long', 'empty']) {
      await visit(mode); await fit();
      await expect(page.getByRole('heading', { level: 2 })).toHaveCount(3);
      if (mode === 'viewer') { await expect(mint()).toHaveCount(0); await expect(page.getByRole('button', { name: t.step1.revoke, exact: true })).toHaveCount(0); }
      if (mode === 'long') await expect(page.getByText(t.unknownDate, { exact: true })).toBeVisible();
      if (mode === 'empty') await expect(page.getByText(t.step1.empty, { exact: true })).toBeVisible();
    }
    for (const mode of ['success', 'failure', 'throw', 'malformed', 'mint-refresh', 'pending']) {
      await visit(mode);
      await mint().click();
      if (mode === 'pending') {
        await expect(page.getByRole('button', { name: t.step1.minting, exact: true })).toBeDisabled();
        await expect.poll(async () => (await calls()).filter(c => c === 'POST').length).toBe(1);
      }
      if (['failure', 'throw', 'malformed'].includes(mode)) {
        await expect(keySection().getByRole('alert')).toHaveText(t.mintUnconfirmed);
        await expect(mint()).toBeDisabled();
        await expect(keySection()).toContainText('sl_example');
        await page.getByRole('button', { name: t.refreshList }).click();
        await expect(mint()).toBeEnabled();
      } else {
        await expect(page.getByRole('status')).toHaveText(t.mintConfirmed);
        await expect(page.getByRole('region', { name: t.step1.colKey, exact: true })).toHaveText('SAMPLE_ONLY_NOT_A_CREDENTIAL');
        if (mode === 'mint-refresh') {
          await expect(keySection().getByRole('alert')).toHaveText(t.mintRefreshFailed);
          await fit();
          await page.getByRole('button', { name: t.refreshList }).click();
          await expect(keySection().getByRole('alert')).toHaveCount(0);
        }
        await expect(mint()).toBeDisabled();
        await page.getByRole('button', { name: t.step1.dismiss, exact: true }).click();
        await expect(page.getByText('SAMPLE_ONLY_NOT_A_CREDENTIAL', { exact: true })).toHaveCount(0);
        await expect(mint()).toBeEnabled();
      }
      assert.equal((await calls()).filter(c => c === 'POST').length, 1);
      interactions++;
    }
    for (const mode of ['success', 'failure', 'throw', 'malformed', 'revoke-refresh', 'pending']) {
      await visit(mode);
      await page.getByRole('button', { name: t.step1.revoke, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('sl_example');
      await targets();
      await dialog.getByRole('button', { name: t.step1.revoke, exact: true }).click();
      if (mode === 'pending') {
        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: common.processing, exact: true })).toBeDisabled();
      }
      if (['failure', 'throw', 'malformed'].includes(mode)) {
        await expect(dialog.getByRole('alert')).toHaveText(t.revokeUnconfirmed);
        await expect(dialog.getByRole('button', { name: t.step1.revoke, exact: true })).toBeDisabled();
        await fit();
        await dialog.getByRole('button', { name: common.close, exact: true }).click();
        await expect(page.getByRole('heading', { name: t.step1.heading, exact: true })).toBeFocused();
        await page.getByRole('button', { name: t.refreshList }).click();
        await expect(page.getByRole('button', { name: t.step1.revoke, exact: true })).toBeEnabled();
      } else {
        await expect(dialog).toHaveCount(0);
        await expect(page.getByRole('status')).toHaveText(t.revokeConfirmed);
        if (mode === 'revoke-refresh') {
          await expect(keySection().getByRole('alert')).toHaveText(t.revokeRefreshFailed);
          await expect(page.getByRole('button', { name: t.step1.revoke, exact: true })).toBeDisabled();
          await page.getByRole('button', { name: t.refreshList }).click();
        }
        await expect(page.getByText(t.step1.revoked, { exact: true })).toBeVisible();
      }
      assert.equal((await calls()).filter(c => c === 'DELETE').length, 1);
      interactions++;
    }
    for (const mode of ['success', 'copy-failed', 'pending']) {
      await visit(mode);
      const copy = page.getByRole('button', { name: `${t.endpointEyebrow}: ${t.copy}`, exact: true });
      await copy.click();
      if (mode === 'pending') await expect(page.getByRole('button', { name: `${t.endpointEyebrow}: ${t.copying}`, exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: `${t.endpointEyebrow}: ${mode === 'copy-failed' ? t.copyFailed : t.copied}`, exact: true })).toBeVisible();
      assert.equal((await calls()).filter(c => c === 'COPY').length, 1);
      await fit(); interactions++;
    }
    await visit('success');
    await page.getByRole('button', { name: t.step3.showAll.replace('{count}', '16'), exact: true }).click();
    await expect(page.getByText('delete_alert', { exact: true })).toBeVisible();
    await fit();
    await page.getByRole('button', { name: t.step3.hideAll, exact: true }).click();
    await expect(page.getByText('delete_alert', { exact: true })).toHaveCount(0);
    interactions++;
    await fit();
    if (locale === 'en') await page.screenshot({ path: join(output, `${theme}-320.png`), fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await context.close();
  }
  console.log(JSON.stringify({ renders, interactions, screenshots: output }));
} finally { await browser.close(); }
