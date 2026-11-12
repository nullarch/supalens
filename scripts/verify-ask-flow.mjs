import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-ask-flow-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const followup = process.argv.includes('--context');
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) {
    const m = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8')), t = m.appAsk;
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
      await context.addInitScript(value => localStorage.setItem('theme', value), theme);
      const errors = [], requests = [];
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === new URL(base).origin && (!['GET', 'HEAD'].includes(request.method()) || url.pathname.startsWith('/api/'))) { requests.push(url.href); return route.abort(); }
        if (url.origin !== new URL(base).origin && !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (/MISSING_MESSAGE|INVALID_MESSAGE|DialogTitle|DialogDescription/.test(message.text())) errors.push(message.text()); });
      const field = page.getByRole('textbox', { name: t.chat.questionLabel, exact: true });
      const send = page.getByRole('button', { name: t.chat.send, exact: true });
      const alert = page.locator('[role="alert"]:not(#__next-route-announcer__)');
      async function calls() { return (await page.locator('[data-ask-calls]').textContent()).split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)); }
      async function starts() { return (await calls()).filter(call => call.path === '/api/agent/analyze'); }
      async function visit(mode, prefill = false) {
        assert.equal((await page.goto(`${base}/dev/analysis?view=ask-live&mode=${mode}${prefill ? '&q=Prefilled%20sample%20question' : ''}`)).status(), 200);
        await page.evaluate(() => document.fonts.ready); await expect(field).toBeVisible();
        assert.equal((await starts()).length, 0);
      }
      async function fit(label) {
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), { message: `${label}: overflow` }).toBe(true);
          renders++;
          if (locale === 'en' && width === 320) await page.screenshot({ path: join(output, `${label}-${theme}.png`), fullPage: true });
        }
      }
      for (const mode of followup ? ['malformed'] : ['success', 'trigger', 'failure', 'throw', 'quota', 'malformed']) {
        await visit(mode, true); await expect(field).toHaveValue('Prefilled sample question'); await fit(`prefill-${mode}`);
        await field.fill('  '); await expect(send).toBeDisabled(); await field.fill('Sample question');
        await field.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 }); assert.equal((await starts()).length, 0);
        await field.press('Shift+Enter'); await expect(field).toHaveValue('Sample question\n'); assert.equal((await starts()).length, 0);
        // Sent: the send button is disabled while starting, then gives its slot to Stop (ChatGPT).
        await field.press('Enter'); await expect.poll(async () => (await send.count()) === 0 || await send.isDisabled()).toBe(true);
        await expect(page.getByRole('button', { name: t.chat.newChat, exact: true })).toBeVisible();
        if (['failure', 'throw', 'quota', 'malformed'].includes(mode)) {
          await expect(alert).toBeVisible(); await fit(`start-error-${mode}`);
          assert.equal((await starts()).length, 1); await expect(page.locator('[data-local-stream]')).toHaveCount(0);
          if (mode === 'quota') await expect(page.getByRole('link', { name: t.quota.upgrade, exact: true })).toHaveAttribute('href', '/app/settings/billing');
          else {
            await expect(alert).toContainText(mode === 'failure' ? t.errors.forbidden : t.chat.startUnconfirmed);
            await page.getByRole('button', { name: 'Restore sample responses' }).click();
            await alert.getByRole('button', { name: t.share.retry, exact: true }).click();
            await expect(page.locator('[data-local-stream]')).toHaveCount(1);
            assert.equal((await starts()).length, 2); assert.deepEqual((await starts())[1].payload.priorRunIds, []);
          }
        } else {
          await expect(page.locator('[data-local-stream]')).toHaveAttribute('data-mode', mode === 'trigger' ? 'trigger' : 'local');
          await expect(page.locator('[data-local-stream]')).toHaveAttribute('data-source', 'sample-a');
          assert.deepEqual((await starts())[0].payload, { dataSourceId: 'sample-a', question: 'Sample question', priorRunIds: [] });
          const stopRegion = page.locator('[data-run-stop]');
          // One answer at a time: while it streams the composer's send slot is its stop button,
          // the question is a bubble on the right of the column, and Enter does not start another.
          await expect(send).toHaveCount(0);
          assert.ok(await stopRegion.getByRole('button').evaluate(el => {
            let box = el.parentElement; while (box && !box.querySelector('textarea')) box = box.parentElement;
            return !!box && /__bar$/.test(box.className);
          }), 'Stop sits in the composer');
          const bubble = await page.locator('[class*="userRow"] [class*="question"]').first().boundingBox();
          const column = await page.locator('[class*="stage"]').first().boundingBox();
          assert.ok(Math.abs(bubble.x + bubble.width - (column.x + column.width)) <= 1 && bubble.width < column.width, 'Question bubble right-aligned in the column');
          await field.fill('Queued while streaming'); await field.press('Enter'); assert.equal((await starts()).length, 1);
          await field.fill('');
          await stopRegion.getByRole('button', { name: t.cancel.stop, exact: true }).click();
          await expect(stopRegion.getByRole('status')).toContainText(t.cancel.requested);
          await expect(stopRegion.getByRole('link')).toHaveAttribute('href', '/app/ask/history/sample-1');
          await expect(page.locator('[data-local-stream]')).toHaveCount(1);
          assert.equal((await page.locator('[data-ask-calls]').innerText()).split('\n').filter(line => line === 'cancel:sample-1').length, 1); interactions++;
          await page.getByRole('button', { name: 'Complete sample run', exact: true }).click();
          await expect(stopRegion).toHaveCount(0); await expect(send).toHaveCount(1);
          const shareTrigger = page.getByRole('button', { name: t.share.manage, exact: true });
          await expect(shareTrigger).toBeVisible(); await fit(`completed-${mode}`);
          // Exercise the actual action controls mounted in the conversation as well
          // as the isolated outcome matrix; all callbacks remain local.
          await shareTrigger.click(); const sharing = page.getByRole('dialog');
          await sharing.getByRole('button', { name: t.share.create, exact: true }).click();
          await expect(sharing.getByRole('textbox', { name: t.share.urlLabel, exact: true })).toHaveValue('https://example.invalid/share/sample-1');
          await sharing.getByRole('button', { name: t.share.copy, exact: true }).click();
          await expect(sharing.getByRole('status')).toHaveText(t.share.copied);
          await sharing.getByRole('button', { name: t.share.unshare, exact: true }).click();
          await expect(sharing.getByRole('status')).toHaveText(t.share.revoked);
          await page.keyboard.press('Escape'); await expect(shareTrigger).toBeFocused(); interactions++;
          await field.fill('Follow-up sample question'); await field.press('Enter'); await expect(page.locator('[data-local-stream]')).toHaveCount(2);
          assert.deepEqual((await starts())[1].payload.priorRunIds, ['sample-1']);
          await page.getByRole('button', { name: t.chat.newChat, exact: true }).click(); await expect(field).toBeFocused();
          await expect(page.locator('[data-local-stream]')).toHaveCount(0);
          await field.fill('Fresh sample question'); await field.press('Enter'); await expect(page.locator('[data-local-stream]')).toHaveCount(1);
          assert.deepEqual((await starts())[2].payload.priorRunIds, []);
        }
        interactions++;
      }
      for (const mode of followup ? ['gate-limit', 'gate-quota', 'gate-poll', 'gate-conflict'] : ['gate-schema', 'gate-repo', 'gate-limit', 'gate-quota', 'gate-failure']) {
        await visit(mode); await field.fill('Sample context question'); await field.press('Enter');
        const extract = page.getByRole('button', { name: mode === 'gate-schema' ? t.contextGate.extractSchema : t.contextGate.extractRepo, exact: true });
        await expect(extract).toBeVisible(); assert.equal((await starts()).length, 0); await fit(`choice-${mode}`);
        await extract.click(); await expect(page.getByRole('button', { name: t.contextGate.proceedNow, exact: true })).toBeVisible();
        await expect(page.getByText(t.contextGate.background, { exact: true })).toBeVisible();
        await expect(page.getByText(t.chat.resetHint, { exact: true })).toBeVisible();
        if (['gate-limit', 'gate-quota', 'gate-failure'].includes(mode)) {
          await expect(alert).toContainText(mode === 'gate-limit' ? t.contextGate.contextLimit : mode === 'gate-quota' ? t.contextGate.quota : t.contextGate.failed);
          assert.equal((await starts()).length, 0); await fit(`choice-error-${mode}`);
          if (['gate-limit', 'gate-quota'].includes(mode)) await expect(page.getByRole('link', { name: t.quota.upgrade, exact: true })).toHaveAttribute('href', '/app/settings/billing');
          await page.getByRole('button', { name: t.contextGate.proceedAnyway, exact: true }).click();
        }
        await expect(page.locator('[data-local-stream]')).toHaveCount(1, { timeout: 10000 });
        assert.equal((await starts()).length, 1); interactions++;
      }
      if (followup) {
        await visit('gate-race'); await field.fill('Proceed without waiting'); await field.press('Enter');
        await page.getByRole('button', { name: t.contextGate.extractRepo, exact: true }).click();
        await page.getByRole('button', { name: t.contextGate.proceedNow, exact: true }).click();
        await expect(page.locator('[data-local-stream]')).toHaveCount(1); await page.waitForTimeout(2400);
        assert.equal((await starts()).length, 1);
        await page.getByRole('button', { name: t.chat.newChat, exact: true }).click();
        await field.fill('Continue using the chosen source'); await field.press('Enter');
        await expect(page.locator('[data-local-stream]')).toHaveCount(1); assert.equal((await starts()).length, 2); interactions++;
        if (locale === 'en' && theme === 'light') {
          await visit('gate-read-error'); await field.fill('Do not trust a failed status response'); await field.press('Enter');
          await page.getByRole('button', { name: t.contextGate.extractRepo, exact: true }).click();
          await expect.poll(async () => (await calls()).filter(call => call.method === 'GET' && call.path.endsWith('/context')).length, { timeout: 10000 }).toBeGreaterThan(0);
          await page.waitForTimeout(900); assert.equal((await starts()).length, 0);
          await page.getByRole('button', { name: 'Restore sample responses' }).click();
          await expect(page.locator('[data-local-stream]')).toHaveCount(1, { timeout: 10000 }); interactions++;
        }
      } else {
      await visit('demo'); await page.getByRole('button', { name: t.chat.demoChips[0], exact: true }).click();
      await expect(page.locator('[data-local-stream]')).toHaveCount(1); assert.equal((await starts())[0].payload.question, t.chat.demoChips[0]); interactions++;
      await visit('success');
      const suggestion = page.getByRole('button').filter({ hasText: 'Paid without access' }).first();
      await suggestion.click(); await expect(field).toBeFocused(); await expect(field).not.toHaveValue(''); assert.equal((await starts()).length, 0); interactions++;

      if (locale === 'en' && theme === 'light') {
        // Late response ignores transport abort; it must not enter the new source thread.
        await visit('slow'); await field.fill('Old source question'); await field.press('Enter');
        await page.getByRole('button', { name: t.chat.sourceLabel, exact: true }).click(); await page.getByRole('option', { name: 'Harbor / staging', exact: true }).click();
        await field.fill('New source question'); await expect(send).toBeEnabled(); await field.press('Enter');
        await expect(page.locator('[data-local-stream]')).toHaveCount(1, { timeout: 8000 });
        await expect(page.locator('[data-local-stream]')).toHaveAttribute('data-source', 'sample-b');
        assert.equal((await starts()).length, 2); assert.deepEqual((await starts())[1].payload.priorRunIds, []);
        await page.getByRole('button', { name: 'Complete sample run' }).click(); await field.fill('Only new source history'); await field.press('Enter');
        await expect(page.locator('[data-local-stream]')).toHaveCount(2, { timeout: 8000 }); assert.deepEqual((await starts())[2].payload.priorRunIds, ['sample-2']); interactions++;
        // Starting a second extraction must never reactivate the abandoned first one.
        await visit('gate-race'); await field.fill('Old context question'); await field.press('Enter'); await page.getByRole('button', { name: t.contextGate.extractRepo, exact: true }).click();
        await page.getByRole('button', { name: t.chat.sourceLabel, exact: true }).click(); await page.getByRole('option', { name: 'Harbor / staging', exact: true }).click();
        await field.fill('New context question'); await field.press('Enter'); await page.getByRole('button', { name: t.contextGate.extractRepo, exact: true }).click();
        await expect(page.locator('[data-local-stream]')).toHaveCount(1); await page.waitForTimeout(2400);
        assert.equal((await starts()).length, 1); assert.equal((await starts())[0].payload.dataSourceId, 'sample-b'); interactions++;
      }
      }
      assert.deepEqual(errors, []); assert.deepEqual(requests, []);
      await context.close(); console.log(`PASS Ask flow ${locale}/${theme}`);
    }
  }
  console.log(JSON.stringify({ renders, interactions, screenshots: output }, null, 2));
} finally { await browser.close(); }
