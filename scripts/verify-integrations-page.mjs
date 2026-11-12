import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { localFixtureOrigin, guardDesignFixture, assertControlTargets } from './lib/design-fixture.mjs';

const base = localFixtureOrigin(process.argv[2]);
const output = await mkdtemp(join(tmpdir(), 'supalens-integrations-page-'));
const browser = await chromium.launch({ headless: true });
let renders = 0, interactions = 0;
const modes = ['populated','empty','long','pending','revoked','expired','error','unknown','slack-unconfigured','slack-unavailable','sources-disabled'];
try {
  for (const locale of ['en','ko','ja']) for (const theme of ['light','dark']) {
    console.log(`Checking integration page: ${locale}/${theme}`);
    const { appIntegrations: t, appCommon: common } = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const context = await browser.newContext({ viewport: { width:1440, height:1000 }, reducedMotion:'reduce' });
    await context.addCookies([{ name:'NEXT_LOCALE', value:locale, url:base }]);
    await context.addInitScript(value => localStorage.setItem('theme',value),theme);
    const errors=[], unexpected=[];
    await guardDesignFixture(context, base, unexpected);
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{ if (/MISSING_MESSAGE|INVALID_MESSAGE/.test(message.text())) errors.push(message.text()); });
    const root=page.locator('[data-integration-view]');
    const card=provider=>root.locator(`[data-provider="${provider}"]`);
    const calls=async()=>JSON.parse(await page.locator('[data-full-integration-calls]').textContent());
    const visit=async(mode='populated',role='owner')=>{
      const url=`${base}/dev/integrations?mode=${mode}&role=${role}`;
      assert.equal((await page.goto(url)).status(),200,url);
      await page.evaluate(()=>document.fonts.ready);
    };
    const fit=async()=>{
      for (const width of [1440,768,390,320]) {
        await page.setViewportSize({width,height:1000});
        await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
        await assertControlTargets(page, '[data-integration-view] button, [role="dialog"] button, [data-setting="integration-scope"] label:has(input)');
        await expect.poll(()=>root.locator('[data-provider]').evaluateAll(nodes=>nodes.every(node=>node.scrollWidth<=node.clientWidth+1))).toBe(true);
        await expect.poll(()=>root.locator('[data-repo-toggle]').evaluateAll(nodes=>nodes.every(node=>{
          const text=node.firstElementChild.getBoundingClientRect(), toggle=node.lastElementChild.getBoundingClientRect();
          return text.left<toggle.left && Math.abs((text.top+text.height/2)-(toggle.top+toggle.height/2))<2;
        }))).toBe(true);
        renders++;
      }
    };
    for (const mode of modes) for (const role of ['owner','admin','member','viewer']) {
      await visit(mode,role); await fit();
      await expect(root.getByRole('heading',{level:1})).toHaveText(t.pageTitle);
      await expect(root.getByText(t.recordedStateHint,{exact:true})).toBeVisible();
      for (const [provider,label] of [['github','GitHub'],['slack','Slack'],['supabase','Supabase'],['databases',t.page.databases.title]]) await expect(card(provider)).toHaveAccessibleName(label);
      // Grouped by what each provider is for: Data (Supabase, direct databases) · Code (GitHub) · Messenger (Slack).
      assert.deepEqual(await root.getByRole('heading',{level:2}).allTextContents(),[t.groups.data,t.groups.code,t.groups.messenger]);
      assert.deepEqual(await root.locator('[data-provider]').evaluateAll(nodes=>nodes.map(node=>node.dataset.provider)),['supabase','databases','github','slack']);
      const manager=['owner','admin'].includes(role), active=!['pending','revoked','expired','error','unknown'].includes(mode);
      await expect(root.locator('a[href^="/api/connect-"]')).toHaveCount(manager ? mode==='slack-unconfigured' ? 2 : ['revoked','expired','error'].includes(mode) ? 4 : 3 : 0);
      await expect(card('github').getByRole('link',{name:t.page.github.manage,exact:true})).toHaveCount(manager && mode!=='empty' ? 1 : 0);
      const sourcesLabel=!manager?t.viewSources:mode==='empty'?t.page.databases.connect:t.manageSources;
      await expect(card('databases').getByRole('link',{name:sourcesLabel,exact:true})).toHaveAttribute('href','/app/sources');
      if(mode==='empty') {
        // Nothing connected = the card head alone: the pill and the action already say it (no empty wells).
        for (const provider of ['supabase','databases','github','slack']) await expect(card(provider).locator(':scope > *')).toHaveCount(1);
        for (const provider of ['supabase','databases','github','slack']) await expect(card(provider)).toContainText(t.summary.none);
      } else {
        await expect(card('databases').locator('li')).toHaveCount(2);
        // A repository's branch sits on its name's line, not under it.
        if(mode==='populated') {
          await page.setViewportSize({width:1440,height:1000});
          for (const repo of await card('github').locator('[class*="repoIdentity"]').all()) {
            const [name,branch]=await repo.evaluate(el=>[...el.children].map(child=>{ const r=child.getBoundingClientRect(); return {top:r.top}; }));
            assert.ok(Math.abs(name.top-branch.top)<6,'branch inline with the repository name');
          }
          // the saved mention scope is stated in words (limited to the one saved channel)
          if(manager) await expect(card('slack').locator('[class*="scopeState"]').first()).toHaveAttribute('data-limited','true');
        }
        await expect(root.getByRole('button',{name:t.page.disconnect,exact:true})).toHaveCount(manager?4:0);
        await expect(card('supabase').getByRole('button',{name:t.page.supabaseCard.resync,exact:true})).toHaveCount(manager&&active?1:0);
        for(const toggle of await card('github').getByRole('switch').all()) if(role==='viewer'||!active) await expect(toggle).toBeDisabled(); else await expect(toggle).toBeEnabled();
        const recovery=mode==='pending'?'pending':['revoked','expired'].includes(mode)?'reconnect':mode==='error'?'error':mode==='unknown'?'unknown':null;
        if(recovery) await expect(card('supabase').getByText(t.recovery[recovery],{exact:true})).toBeVisible();
        if(mode==='unknown') await expect(root).not.toContainText('unexpected_record_value');
        if(mode==='slack-unconfigured') { await expect(card('slack')).toContainText('Business team'); await expect(card('slack')).toContainText('Engineering team'); }
        if(mode==='slack-unavailable'&&manager) await expect(card('slack').getByText(t.scopeUnavailable,{exact:true})).toHaveCount(2);
      }
      assert.deepEqual(await calls(),[]);
      if(mode==='long'&&role==='owner') {
        await card('github').screenshot({path:join(output,`${locale}-${theme}-github-long-320.png`)});
        await card('supabase').screenshot({path:join(output,`${locale}-${theme}-supabase-long-320.png`)});
      }
    }
    await visit();
    const originalUrl=page.url();
    await card('github').getByRole('link',{name:t.page.github.add,exact:true}).click();
    assert.equal(page.url(),originalUrl); interactions++;
    const github=card('github');
    await github.getByRole('switch').first().click();
    await expect(github.getByText(t.page.github.repoMeta.replace('{repos}','2').replace('{on}','0'),{exact:true})).toBeVisible();
    assert.deepEqual((await calls())[0],{action:'toggle',repoId:'sample-repo-a',enabled:false}); interactions++;
    const slackScopes=card('slack').locator('[data-setting="integration-scope"]');
    await expect(slackScopes).toHaveCount(2);
    await slackScopes.nth(1).getByRole('checkbox',{name:'#deployments',exact:true}).check();
    await slackScopes.nth(1).getByRole('button',{name:t.page.slackScope.save,exact:true}).click();
    await expect(slackScopes.nth(1).getByRole('status')).toBeVisible();
    assert.deepEqual((await calls())[1],{action:'scope',connectionId:'sample-slack-b',ids:['CE','CF']});
    await expect(slackScopes.first().getByRole('checkbox',{name:'#business-alerts',exact:true})).toBeChecked();
    await expect(slackScopes.first().getByRole('checkbox',{name:'#operations',exact:true})).not.toBeChecked(); interactions++;
    for (const provider of ['github','supabase']) {
      await visit();
      const trigger=card(provider).getByRole('button',{name:t.page.disconnect,exact:true});
      await trigger.click(); await expect(page.getByRole('dialog')).toContainText(provider==='github'?'Northstar':'Northstar projects');
      await page.keyboard.press('Escape'); await expect(trigger).toBeFocused(); assert.deepEqual(await calls(),[]);
      await trigger.click(); await page.getByRole('dialog').getByRole('button',{name:t.page.disconnect,exact:true}).click();
      await expect(card(provider).getByRole('status').first()).toHaveText(t.actionFinished);
      assert.deepEqual(await calls(),[{action:'disconnect',connectionId:provider==='github'?'sample-gh':'sample-supa'}]); interactions++;
    }
    await visit('pending');
    await expect(card('supabase').getByRole('link',{name:t.page.supabaseCard.reconnect,exact:true})).toHaveCount(0);
    await expect(card('supabase').getByRole('button',{name:t.page.supabaseCard.resync,exact:true})).toHaveCount(0);
    await expect(card('supabase').getByText(t.recovery.pending,{exact:true})).toBeVisible(); interactions++;
    await visit('long'); await fit();
    await card('supabase').getByRole('button',{name:t.page.supabaseCard.resync,exact:true}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button',{name:common.close,exact:true}).click();
    interactions++;
    assert.deepEqual(errors,[]); assert.deepEqual(unexpected,[]);
    await context.close();
  }
  console.log(JSON.stringify({renders,interactions,screenshots:output}));
} finally { await browser.close(); }
