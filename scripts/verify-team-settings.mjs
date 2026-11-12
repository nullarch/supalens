import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { localFixtureOrigin, guardDesignFixture, assertControlTargets } from './lib/design-fixture.mjs';

const base = localFixtureOrigin(process.argv[2]);
const output = await mkdtemp(join(tmpdir(), 'supalens-team-settings-'));
const browser = await chromium.launch({ headless: true });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    console.log(`Checking team settings: ${locale}/${theme}`);
    const { appMembers: t, appCommon: common } = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    const errors = [], unexpected = [];
    await guardDesignFixture(context, base, unexpected);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { errors.push('Unexpected native confirmation'); void dialog.dismiss(); });
    page.on('console', msg => { if (/MISSING_MESSAGE|INVALID_MESSAGE/.test(msg.text())) errors.push(msg.text()); });
    const root = page.locator('[data-setting="team"]');
    const calls = async () => JSON.parse(await page.locator('[data-team-calls]').textContent());
    const row = name => root.getByRole('row').filter({ hasText: name });
    const targets = () => assertControlTargets(page, '[data-setting="team"] button, [data-setting="team"] input, [role="dialog"] button');
    const visit = async mode => {
      assert.equal((await page.goto(`${base}/dev/settings?view=team-actions&mode=${mode}`)).status(), 200);
      await page.evaluate(() => document.fonts.ready);
    };
    const fit = async () => {
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await expect.poll(() => root.locator('tbody td:first-child strong').evaluateAll(nodes => nodes.every(node => node.parentElement.getBoundingClientRect().width >= 150))).toBe(true);
        await targets();
        renders++;
      }
    };
    for (const mode of ['success', 'admin', 'member', 'viewer', 'long', 'empty']) {
      await visit(mode); await fit();
      if (['member', 'viewer'].includes(mode)) {
        await expect(root.locator('form')).toHaveCount(0);
        await expect(root.getByRole('button', { name: t.actions.remove, exact: true })).toHaveCount(0);
        await expect(root.getByRole('button', { name: t.actions.transferOwnership, exact: true })).toHaveCount(0);
      }
      if (mode === 'admin') {
        await expect(root.getByRole('button', { name: t.actions.transferOwnership, exact: true })).toHaveCount(0);
        await expect(row('Sam Park').getByRole('button')).toHaveCount(0);
      }
      if (mode === 'long') await expect(root.getByText(t.unknownDate, { exact: true })).toBeVisible();
      if (mode === 'empty') await expect(root.getByText(t.emptyMembers, { exact: true })).toBeVisible();
      if (mode === 'success') {
        const tableRegion = root.getByRole('region', { name: t.table.cardTitle, exact: true }).filter({ has: page.getByRole('table') }).filter({ hasNot: page.getByRole('heading') });
        await tableRegion.evaluate(node => { node.scrollLeft = 0; });
        await tableRegion.focus(); await page.keyboard.press('ArrowRight');
        await expect.poll(() => tableRegion.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
        interactions++;
      }
    }
    for (const action of ['remove', 'transfer', 'leave', 'revoke']) for (const mode of ['success', 'failure', 'throw', 'malformed', 'pending', 'refresh-failure']) {
      await visit(mode); await page.setViewportSize({ width: 1440, height: 1000 });
      const trigger = action === 'leave' ? row('Alex Morgan').getByRole('button', { name: t.actions.leave, exact: true })
        : action === 'revoke' ? root.getByRole('listitem').filter({ hasText: 'pending@example.com' }).getByRole('button', { name: t.actions.cancel, exact: true })
          : row('Jordan Lee').getByRole('button', { name: action === 'remove' ? t.actions.remove : t.actions.transferOwnership, exact: true });
      await trigger.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await targets();
      if (action !== 'leave') await expect(dialog).toContainText(action === 'revoke' ? 'pending@example.com' : 'Jordan Lee');
      assert.deepEqual(await calls(), []);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
      await trigger.click();
      await dialog.getByRole('button', { name: common.confirm, exact: true }).click();
      if (mode === 'pending') {
        await expect(dialog.getByRole('button', { name: common.processing, exact: true })).toBeDisabled();
        await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
      }
      if (['failure', 'throw', 'malformed'].includes(mode)) {
        await expect(dialog.getByRole('alert')).toHaveText(mode === 'failure' ? t.toast.actionFailed : t.unconfirmed);
        await fit();
        if (mode !== 'failure') await expect(dialog.getByRole('button', { name: common.confirm, exact: true })).toBeDisabled();
        await dialog.getByRole('button', { name: common.close, exact: true }).click();
        if (mode !== 'failure') await expect(root.getByRole('link', { name: t.reload, exact: true })).toHaveAttribute('href', '/dev/settings?view=team-actions&mode=success');
        assert.equal((await calls()).filter(c => c === 'refresh').length, 0);
      } else {
        await expect(dialog).toHaveCount(0);
        const success = { remove: t.toast.removed, transfer: t.toast.ownershipTransferred, leave: t.toast.left, revoke: t.toast.inviteRevoked }[action];
        await expect(root.getByRole('status')).toContainText(success);
        if (mode === 'refresh-failure') await expect(root.getByRole('status')).toContainText(t.refreshFailed);
        else if (action === 'remove') await expect(row('Jordan Lee')).toHaveCount(0);
        else if (action === 'transfer') await expect(row('Jordan Lee')).toContainText(t.role.owner);
        else if (action === 'leave') await expect(row('Alex Morgan')).toHaveCount(0);
        else await expect(root.getByRole('listitem').filter({ hasText: 'pending@example.com' })).toHaveCount(0);
        await fit();
      }
      assert.equal((await calls()).filter(c => c === action).length, 1); interactions++;
    }
    for (const mode of ['success', 'failure', 'throw', 'malformed', 'pending', 'refresh-failure']) {
      await visit(mode); await page.setViewportSize({ width: 1440, height: 1000 });
      await row('Jordan Lee').getByRole('button', { name: `${t.table.colRole}: Jordan Lee`, exact: true }).click();
      await targets();
      await page.getByRole('option', { name: t.role.viewer, exact: true }).click();
      if (['failure', 'throw', 'malformed'].includes(mode)) await expect(root.getByRole('alert')).toHaveText(mode === 'failure' ? t.toast.actionFailed : t.unconfirmed);
      else {
        await expect(root.getByRole('status')).toContainText(t.toast.roleChanged);
        if (mode !== 'refresh-failure') await expect(row('Jordan Lee').getByRole('button', { name: `${t.table.colRole}: Jordan Lee`, exact: true })).toContainText(t.role.viewer);
      }
      assert.equal((await calls()).filter(c => c === 'role').length, 1); interactions++;
    }
    for (const mode of ['success', 'failure', 'throw', 'malformed', 'pending', 'invite-fallback', 'copy-failure', 'copy-pending', 'refresh-failure']) {
      await visit(mode);
      const email = root.getByRole('textbox', { name: t.invite.emailPlaceholder, exact: true });
      await email.fill('invitee@example.com');
      await root.getByRole('button', { name: t.invite.send, exact: true }).click();
      if (mode === 'pending') {
        await expect(email).toBeDisabled();
        await root.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
      }
      if (['failure', 'throw', 'malformed'].includes(mode)) {
        await expect(root.getByRole('alert')).toHaveText(mode === 'failure' ? t.toast.actionFailed : t.unconfirmed);
        await expect(email).toHaveValue('invitee@example.com');
      } else {
        await expect(email).toHaveValue('');
        await expect(root.getByRole('status')).toBeVisible();
        if (['invite-fallback', 'copy-failure', 'copy-pending'].includes(mode)) {
          await expect(root.getByRole('status')).toContainText('https://supalens.example/app/invite/sample-only');
          await root.getByRole('button', { name: t.invite.copy, exact: true }).click();
          if (mode === 'copy-pending') await expect(root.getByRole('button', { name: common.processing, exact: true })).toBeDisabled();
          await expect(root.getByRole('button', { name: mode === 'copy-failure' ? t.copyFailed : t.copied, exact: true })).toBeVisible();
          assert.equal((await calls()).filter(c => c === 'copy').length, 1);
        }
      }
      assert.equal((await calls()).filter(c => c === 'invite').length, 1);
      await fit(); interactions++;
      if (mode === 'invite-fallback' && locale === 'en') await page.screenshot({ path: join(output, `${theme}-invite-fallback-320.png`), fullPage: true });
    }
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await context.close();
  }
  console.log(JSON.stringify({ renders, interactions, screenshots: output }));
} finally { await browser.close(); }
