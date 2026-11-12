import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const source = await readFile('src/app/dev/invitations/page.tsx', 'utf8');
const modes = JSON.parse(source.match(/const INVITATION_MODES = (\[[^\]]+\])/)[1].replaceAll("'", '"'));
const output = await mkdtemp(join(tmpdir(), 'supalens-invitation-design-'));
const browser = await chromium.launch({ channel: 'chrome' });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    console.log(`Invitation: ${locale}/${theme}`);
    const { appMembers: { accept: t } } = JSON.parse(await readFile(`messages/${locale}.json`, 'utf8'));
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    const errors = [], unexpected = [];
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(base).origin) {
        const staticFont = ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)
          || (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/gh/orioncactus/pretendard@v1.3.9/'));
        return request.method() === 'GET' && staticFont ? route.continue() : route.abort();
      }
      if (request.method() !== 'GET' || /^\/(api|auth|app)(\/|$)/.test(url.pathname)) {
        unexpected.push(`${request.method()} ${url.pathname}`); return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/MISSING_MESSAGE|INVALID_MESSAGE/.test(message.text())) errors.push(message.text()); });
    page.on('dialog', dialog => { errors.push('Unexpected native dialog'); void dialog.dismiss(); });
    const shell = page.locator('[data-invitation-shell]');
    const form = page.locator('[data-invitation-form]');
    const calls = async () => JSON.parse(await page.locator('[data-invitation-calls]').textContent());
    const acceptedCalls = async () => (await calls()).filter(item => item?.action === 'accept');
    const fit = async () => {
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await expect(shell.getByRole('heading', { level: 1 })).toBeVisible();
        for (const control of await shell.locator('button,a').all()) {
          await expect(control).toHaveAccessibleName(/.+/);
          assert(await control.evaluate(node => node.getBoundingClientRect().height >= 44));
        }
        assert(!/PRIVATE_/.test(await shell.textContent()));
        const smallText = await shell.locator('p').evaluateAll(nodes => nodes.some(node => parseFloat(getComputedStyle(node).fontSize) < 13));
        assert.equal(smallText, false);
        const noticeColors = await shell.locator('[data-kind]').evaluateAll(nodes => nodes.every(node => {
          const intent = node.dataset.kind === 'accepted' ? 'positive' : node.dataset.kind === 'rejected' ? 'negative' : 'warning';
          const token = getComputedStyle(document.documentElement).getPropertyValue(`--intent-${intent}`).trim();
          const expected = `rgb(${token.slice(1).match(/../g).map(part => parseInt(part, 16)).join(', ')})`;
          const style = getComputedStyle(node);
          const luminance = color => {
            const rgb = color.match(/[\d.]+/g).slice(0, 3).map(part => { const value = Number(part) / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
            return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
          };
          const [light, dark] = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => b - a);
          return style.color === expected && (light + .05) / (dark + .05) >= 4.5;
        }));
        assert.equal(noticeColors, true, 'Notice meaning/contrast must match semantic tokens');
        renders++;
      }
    };
    for (const mode of modes) {
      assert.equal((await page.goto(`${base}/dev/invitations?mode=${mode}`)).status(), 200, mode);
      await page.evaluate(() => document.fonts.ready);
      await fit();
      assert.deepEqual(await calls(), []);
      if (['unconfigured', 'preview-unavailable', 'expired', 'processed', 'missing', 'mismatch'].includes(mode)) {
        await expect(form).toHaveCount(0);
        if (mode === 'mismatch') await page.screenshot({ path: join(output, `${locale}-${theme}-mismatch-320.png`), fullPage: true });
        if (mode !== 'unconfigured') { await shell.getByRole('link', { name: t.home, exact: true }).click(); assert.deepEqual(await calls(), ['home']); interactions++; }
        if (mode === 'preview-unavailable') {
          await expect(shell).toContainText(t.previewUnavailable);
          await shell.getByRole('link', { name: t.reload, exact: true }).click();
          assert.deepEqual(await calls(), ['home', 'reload']); interactions++;
        }
        continue;
      }
      if (mode === 'long') await page.screenshot({ path: join(output, `${locale}-${theme}-long-320.png`), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      const confirm = form.getByRole('button', { name: t.confirm, exact: true });
      await confirm.focus(); await page.keyboard.press('Enter'); interactions++;
      if (mode === 'pending' || mode === 'stale') {
        await expect(form.getByRole('button', { name: t.accepting, exact: true })).toBeDisabled();
        await expect(form.getByRole('link')).toHaveCount(0);
        await form.getByRole('button', { name: t.accepting, exact: true }).evaluate(button => { button.click(); button.click(); });
        assert.equal((await acceptedCalls()).length, 1);
        await fit(); interactions++;
        if (mode === 'stale') {
          await page.getByRole('button', { name: 'Switch sample invitation', exact: true }).click();
          await expect(shell).toContainText('Harbor');
          await expect(form.getByRole('button', { name: t.confirm, exact: true })).toBeEnabled();
        }
        await page.locator('[data-external-focus]').focus();
        await page.getByRole('button', { name: 'Resolve local acceptance', exact: true }).evaluate(button => button.click());
        if (mode === 'stale') {
          await page.waitForTimeout(120);
          assert(!(await calls()).includes('navigate-members'));
          await expect(form.getByRole('button', { name: t.confirm, exact: true })).toBeEnabled();
          await expect(page.locator('[data-external-focus]')).toBeFocused();
          await form.getByRole('button', { name: t.confirm, exact: true }).click();
          await page.getByRole('button', { name: 'Resolve local acceptance', exact: true }).click();
          await expect(form).toContainText(t.accepted);
          assert.deepEqual((await acceptedCalls()).map(item => item.token), ['sample-invite-A', 'sample-invite-B']);
          interactions += 3;
        } else {
          await expect(form).toContainText(t.accepted);
          await expect(page.locator('[data-external-focus]')).toBeFocused();
        }
      }
      if (mode === 'navigation-pending') {
        await expect(form).toContainText(t.opening);
        await expect(form.getByRole('button', { name: t.viewMembers, exact: true })).toBeDisabled();
        await expect(form.getByRole('link')).toHaveCount(0);
        await fit();
        await page.getByRole('button', { name: 'Resolve local navigation', exact: true }).click(); interactions++;
      }
      const unknown = ['throw', 'malformed', 'missing-org', 'reload-failed'].includes(mode);
      const denied = ['unauthorized', 'unavailable'].includes(mode);
      if (unknown || denied || ['rejected', 'retry'].includes(mode)) {
        await expect(form.getByRole('alert').first()).toContainText(unknown ? t.unconfirmed : denied ? mode === 'unauthorized' ? t.sessionUnavailable : t.serviceUnavailable : t.rejected);
        if (unknown || denied) await expect(form.getByRole('button', { name: t.confirm, exact: true })).toBeDisabled();
        else await expect(form.getByRole('button', { name: t.confirm, exact: true })).toBeEnabled();
        if (unknown || denied) await expect(form.locator('[data-save-notice]')).toBeFocused();
        else await expect(form.getByRole('button', { name: t.confirm, exact: true })).toBeFocused();
        assert(!(await calls()).includes('navigate-members'));
        if (mode === 'retry') {
          await form.getByRole('button', { name: t.confirm, exact: true }).click();
          await expect(form).toContainText(t.accepted);
          assert.equal((await acceptedCalls()).length, 2); interactions++;
        } else {
          await form.getByRole('button', { name: t.reload, exact: true }).click();
          assert((await calls()).includes('reload'));
          assert.equal((await acceptedCalls()).length, 1); interactions++;
          if (mode === 'reload-failed') await expect(form).toContainText(t.reloadFailed);
        }
      } else {
        await expect(form).toContainText(t.accepted);
        await expect(form.getByRole('button', { name: t.viewMembers, exact: true })).toBeEnabled();
        if (mode === 'navigation-failed') {
          await expect(form).toContainText(t.navigationFailed);
          await fit();
          await page.screenshot({ path: join(output, `${locale}-${theme}-navigation-before-retry-320.png`), fullPage: true });
          await form.getByRole('button', { name: t.viewMembers, exact: true }).click();
          await expect(form).not.toContainText(t.navigationFailed);
          assert.equal((await calls()).filter(item => item === 'navigate-members').length, 2);
          assert.equal((await acceptedCalls()).length, 1); interactions++;
        }
      }
      await fit();
      if (['throw', 'navigation-failed', 'reload-failed'].includes(mode)) await page.screenshot({ path: join(output, `${locale}-${theme}-${mode}-320.png`), fullPage: true });
      const home = form.getByRole('link', { name: t.home, exact: true });
      await home.click(); assert((await calls()).includes('home')); interactions++;
    }
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await context.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ modes: modes.length, renders, interactions, output }));
