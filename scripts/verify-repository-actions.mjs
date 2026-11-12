import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { localFixtureOrigin, guardDesignFixture, assertControlTargets } from './lib/design-fixture.mjs';

const base = localFixtureOrigin(process.argv[2]);
const output = await mkdtemp(join(tmpdir(), 'supalens-repository-actions-'));
const browser = await chromium.launch({ headless: true });
let renders = 0, interactions = 0;
const modes = ['success','failure','throw','malformed','pending','viewer','long','empty','refresh-failure','quota','trigger','server-error','stream-error','retry','banner-error','banner-cancel','banner-restart','banner-claimed','banner-import','banner-invalid'];
const luminance = color => {
  const channels = color.match(/[\d.]+/g).slice(0,3).map(Number).map(value => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
};
const contrast = (a,b) => { const x=luminance(a), y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
try {
  for (const locale of ['en','ko','ja']) for (const theme of ['light','dark']) {
    console.log(`Checking repositories: ${locale}/${theme}`);
    const { appIntegrations: t } = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    const errors = [], unexpected = [];
    await guardDesignFixture(context, base, unexpected);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/MISSING_MESSAGE|INVALID_MESSAGE/.test(message.text())) errors.push(message.text()); });
    const root = page.locator('[data-setting="repositories"]');
    const firstSwitch = root.getByRole('switch').first();
    const analyze = root.getByRole('button', { name: t.repoAnalyzeLabel.replace('{repo}', 'northstar/payments'), exact: true });
    const calls = async () => JSON.parse(await page.locator('[data-repo-calls]').textContent());
    const visit = async mode => {
      assert.equal((await page.goto(`${base}/dev/settings?view=repository-actions&mode=${mode}`)).status(), 200);
      await page.evaluate(() => document.fonts.ready);
    };
    const fit = async () => {
      for (const width of [1440,768,390,320]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await assertControlTargets(page, '[data-setting="repositories"] button:not([data-fixture-control])');
        const switches = await root.getByRole('switch').evaluateAll(nodes => nodes.filter(node => !node.disabled).map(node => ({
          track:getComputedStyle(node, '::before').backgroundColor, knob:getComputedStyle(node.firstElementChild).backgroundColor,
          surface:getComputedStyle(node.closest('li')).backgroundColor,
          trackWidth: getComputedStyle(node, '::before').width, trackHeight: getComputedStyle(node, '::before').height,
        })));
        for (const colors of switches) {
          assert.equal(colors.trackWidth, '40px'); assert.equal(colors.trackHeight, '22px');
          assert(contrast(colors.track, colors.surface) >= 3, `Switch track/surface contrast: ${JSON.stringify(colors)}`);
          assert(contrast(colors.track, colors.knob) >= 3, `Switch knob/track contrast: ${JSON.stringify(colors)}`);
        }
        renders++;
      }
    };
    for (const mode of modes) {
      await visit(mode); await fit();
      await expect(page.locator('main')).not.toContainText('private');
      await expect(page.locator('main')).not.toContainText('NaN');
      if (mode !== 'empty') await expect(root).toHaveAccessibleName(t.repoSection);
      if (mode === 'viewer') { await expect(firstSwitch).toBeDisabled(); await expect(analyze).toBeDisabled(); }
      if (mode === 'empty') await expect(page.getByText(t.empty, { exact: true })).toBeVisible();
      if (mode === 'banner-invalid') await expect(page.getByRole('region', { name: 'Return banner samples' }).getByRole('status')).toHaveCount(0);
      if (mode.startsWith('banner-') && !['banner-invalid','banner-import'].includes(mode)) await expect(page.getByRole('region', { name: 'Return banner samples' }).getByRole('alert')).toBeVisible();
      if (mode === 'banner-import') await expect(page.getByRole('link', { name: t.page.bannerSkippedForPlanCta, exact: true })).toHaveAttribute('href','/app/settings/billing');
      assert.deepEqual(await calls(), []);
      if (mode === 'long') await page.screenshot({ path: join(output, `${locale}-${theme}-long-320.png`), fullPage: true });
    }
    for (const mode of ['success','failure','throw','malformed','pending','refresh-failure']) {
      await visit(mode);
      // The corner is outside the painted track, inside the actual 44px button.
      await firstSwitch.click(mode === 'success' ? { position: { x: 2, y: 2 } } : undefined);
      if (mode === 'pending') {
        await expect(firstSwitch).toBeDisabled(); await expect(analyze).toBeDisabled();
        await firstSwitch.evaluate(button => { button.click(); button.click(); });
        await expect(firstSwitch).toHaveAttribute('aria-checked','true');
      }
      if (['failure','throw','malformed'].includes(mode)) {
        await expect(root.getByRole('alert')).toHaveText(mode === 'failure' ? t.repoSaveFailed : t.repoUnconfirmed);
        await expect(firstSwitch).toHaveAttribute('aria-checked','true');
        if (mode !== 'failure') { await expect(firstSwitch).toBeDisabled(); await expect(root.getByRole('link', { name: t.reloadSettings, exact: true })).toHaveAttribute('href','/dev/settings?view=repository-actions&mode=success'); }
        else await expect(firstSwitch).toBeEnabled();
      } else {
        await expect(root.getByRole('status')).toHaveText(mode === 'refresh-failure' ? t.repoRefreshFailed : t.repoSaved.replace('{repo}','northstar/payments'));
        await expect(firstSwitch).toHaveAttribute('aria-checked','false');
      }
      assert.deepEqual(await calls(), [{ action:'toggle', repoId:'repo-A-1', enabled:'false' }]);
      await fit(); interactions++;
    }
    for (const mode of ['success','failure','throw','malformed','pending','quota','trigger','server-error','stream-error']) {
      await visit(mode);
      const source = root.getByRole('button', { name:t.crossDbLabel, exact:true });
      await source.click(); await page.getByRole('option', { name:'Sample DB', exact:true }).click();
      await analyze.click();
      if (mode === 'pending') {
        await expect(analyze).toBeDisabled(); await expect(source).toBeDisabled(); await expect(firstSwitch).toBeDisabled();
        await analyze.evaluate(button => { button.click(); button.click(); });
      }
      if (['success','pending','stream-error'].includes(mode)) {
        await expect(root.getByRole('status')).toHaveText(t.repoQueued);
        await expect(page.locator('[data-repo-run]')).toContainText('Sample DB');
        await expect(analyze).toBeDisabled();
        await page.getByRole('button', { name:'Finish sample run', exact:true }).click();
        if (mode === 'stream-error') { await expect(root.getByRole('alert')).toHaveText(t.repoRunUnconfirmed); await expect(analyze).toBeDisabled(); }
        else { await expect(root.getByRole('status')).toHaveText(t.repoRunFinished); await expect(analyze).toBeEnabled(); }
      } else {
        const label = mode === 'quota' ? t.repoErrors.quota : mode === 'trigger' ? t.errors.triggerRequired : mode === 'failure' ? t.repoErrors.rejected : t.repoStartUnconfirmed;
        await expect(root.getByRole('alert')).toHaveText(label);
        await expect(page.locator('[data-repo-run]')).toHaveCount(0);
        if (['throw','malformed','server-error'].includes(mode)) await expect(analyze).toBeDisabled();
        else await expect(analyze).toBeEnabled();
      }
      assert.deepEqual(await calls(), [{ action:'analyze', repoId:'repo-A-1', dataSourceId:'db-A' }]);
      await expect(root).not.toContainText('private'); await fit(); interactions++;
    }
    await visit('retry'); await analyze.click();
    await page.getByRole('button', { name:'Finish sample run', exact:true }).click(); await expect(analyze).toBeEnabled();
    await analyze.click(); await expect(root.getByRole('alert')).toHaveText(t.repoErrors.rejected);
    await expect(page.locator('[data-repo-run]')).toBeVisible(); interactions++;
    await visit('success');
    await root.getByRole('button', { name:t.crossDbLabel, exact:true }).click();
    await assertControlTargets(page, '[data-setting="repositories"] [role="option"] button');
    await page.getByRole('option', { name:'Sample DB', exact:true }).click();
    await page.getByRole('button', { name:'Remove sample source', exact:true }).click();
    await expect(root.getByRole('alert')).toHaveText(t.repoSourceUnavailable); await expect(analyze).toBeDisabled();
    await root.getByRole('button', { name:t.crossDbLabel, exact:true }).click();
    await page.getByRole('option', { name:t.codeOnly, exact:true }).click(); await expect(analyze).toBeEnabled();
    assert.deepEqual(await calls(), []); interactions++;
    for (const action of ['toggle','analyze']) {
      await visit('pending'); await (action === 'toggle' ? firstSwitch : analyze).click();
      await page.getByRole('button', { name:'Switch sample workspace', exact:true }).click();
      await expect(page.locator('[data-repo-workspace]')).toHaveText('B');
      await page.waitForTimeout(1000);
      await expect(root.getByRole('status')).toHaveCount(0); await expect(page.locator('[data-repo-run]')).toHaveCount(0);
      await expect(firstSwitch).toHaveAttribute('aria-checked','true'); await expect(analyze).toBeEnabled(); interactions++;
    }
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await context.close();
  }
  console.log(JSON.stringify({ renders, interactions, screenshots:output }));
} finally { await browser.close(); }
