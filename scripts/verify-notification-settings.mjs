import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { localFixtureOrigin, guardDesignFixture, assertControlTargets } from './lib/design-fixture.mjs';

const base = localFixtureOrigin(process.argv[2]);
const output = await mkdtemp(join(tmpdir(), 'supalens-notification-settings-'));
const browser = await chromium.launch({ headless: true });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    console.log(`Checking notifications: ${locale}/${theme}`);
    const { appNotifications: t, appCommon: common } = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    const errors = [], unexpected = [];
    await guardDesignFixture(context, base, unexpected);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (/MISSING_MESSAGE|INVALID_MESSAGE/.test(msg.text())) errors.push(msg.text()); });
    const section = name => page.locator(`[data-setting="${name}"]`);
    const calls = async () => JSON.parse(await page.locator('[data-notification-calls]').textContent());
    const visit = async mode => {
      assert.equal((await page.goto(`${base}/dev/settings?view=notification-actions&mode=${mode}`)).status(), 200);
      await page.evaluate(() => document.fonts.ready);
    };
    const fit = async () => {
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await assertControlTargets(page, '[data-setting] button, [data-setting] input');
        renders++;
      }
    };
    const testButton = () => section('test').getByRole('button', { name: t.test.button, exact: true });
    for (const mode of ['success', 'viewer', 'unavailable', 'disconnected', 'unconfigured', 'long']) {
      await visit(mode); await fit();
      if (['viewer', 'unavailable'].includes(mode)) {
        await expect(page.getByRole('button')).toHaveCount(0);
        await expect(page.locator('input')).toHaveCount(0);
        await expect(page.getByText(mode === 'viewer' ? t.readOnly : t.configUnavailable, { exact: true })).toBeVisible();
      } else {
        await expect(page.getByRole('heading', { level: 2 })).toHaveCount(6);
        await expect(page.locator('input[type="password"]')).toHaveCount(2);
      }
      if (mode === 'disconnected') await expect(page.getByRole('button', { name: t.slackBot.connect })).toBeDisabled();
      if (mode === 'unconfigured') await expect(page.getByText(t.slackBot.connectUnavailable, { exact: true })).toBeVisible();
    }
    for (const action of ['slack', 'discord', 'bot']) for (const mode of ['success', 'failure', 'throw', 'malformed', 'pending', 'refresh-failure']) {
      await visit(mode);
      const card = section(action);
      if (action === 'bot') {
        await card.getByRole('button', { name: t.slackBot.channel, exact: true }).click();
        await assertControlTargets(page, '[data-setting] button');
        await page.getByRole('option', { name: t.slackBot.noChannel, exact: true }).click();
      } else {
        const input = card.getByLabel(t.webhookUrl, { exact: true });
        await input.fill('https://example.com/SAMPLE_ONLY');
        await card.getByRole('button', { name: t.revealWebhook, exact: true }).click();
        await expect(input).toHaveAttribute('type', 'text');
        await card.getByRole('button', { name: t.revealWebhook, exact: true }).click();
        await expect(input).toHaveAttribute('type', 'password');
      }
      await expect(testButton()).toBeDisabled();
      await expect(page.getByText(t.unsavedHint, { exact: true })).toBeVisible();
      await card.getByRole('button', { name: t.cta.save, exact: true }).click();
      if (mode === 'pending') {
        await expect(card.getByRole('button', { name: common.processing, exact: true })).toBeDisabled();
        for (const input of await page.locator('input').all()) await expect(input).toBeDisabled();
      }
      if (['failure', 'throw', 'malformed'].includes(mode)) {
        await expect(card.getByRole('alert')).toHaveText(mode === 'failure' ? t.notice.requestFailed : t.saveUnconfirmed);
        await expect(testButton()).toBeDisabled();
        if (action !== 'bot') await expect(card.getByLabel(t.webhookUrl, { exact: true })).toHaveValue('https://example.com/SAMPLE_ONLY');
        assert.equal((await calls()).filter(c => c === 'refresh').length, 0);
      } else {
        await expect(card.getByRole('status')).toHaveText(mode === 'refresh-failure' ? t.refreshFailed : action === 'bot' ? t.slackBot.botRemoved : action === 'slack' ? t.slackWebhook.saved : t.discord.saved);
        if (mode !== 'refresh-failure') await expect(testButton()).toBeEnabled();
      }
      await fit();
      assert.equal((await calls()).filter(c => c === action).length, 1);
      interactions++;
      if (mode === 'success' && action !== 'bot') {
        await card.getByLabel(t.webhookUrl, { exact: true }).fill('');
        await card.getByRole('button', { name: t.cta.save, exact: true }).click();
        await expect(card.getByRole('status')).toHaveText(action === 'slack' ? t.slackWebhook.removed : t.discord.removed);
        await expect(card.getByText(t.status.notConfigured, { exact: true })).toBeVisible();
        interactions++;
      }
    }
    for (const mode of ['success', 'none', 'channel-only', 'email-only', 'failure', 'throw', 'malformed', 'pending']) {
      await visit(mode); await testButton().click();
      if (mode === 'pending') await expect(section('test').getByRole('button', { name: t.test.sending, exact: true })).toBeDisabled();
      if (['failure', 'throw', 'malformed'].includes(mode)) await expect(section('test').getByRole('alert')).toHaveText(mode === 'failure' ? t.notice.requestFailed : t.testUnconfirmed);
      else {
        const result = section('test').getByRole('status');
        await expect(result).toContainText(t.deliveryCaveat);
        const channels = !['none', 'email-only'].includes(mode), email = !['none', 'channel-only'].includes(mode);
        await expect(result.locator('dd').nth(0)).toHaveText(channels ? t.channelsAccepted : t.sendNotConfirmed);
        await expect(result.locator('dd').nth(1)).toHaveText(email ? t.emailAccepted : t.sendNotConfirmed);
        await expect(result).toHaveAttribute('data-kind', channels && email ? 'ok' : 'info');
      }
      await expect(testButton()).toBeEnabled();
      assert.equal((await calls()).filter(c => c === 'test').length, 1);
      await fit(); interactions++;
      if (mode === 'channel-only' && locale === 'en') await page.screenshot({ path: join(output, `${theme}-partial-320.png`), fullPage: true });
    }
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await context.close();
  }
  console.log(JSON.stringify({ renders, interactions, screenshots: output }));
} finally { await browser.close(); }
