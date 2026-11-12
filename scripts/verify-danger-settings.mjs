import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';

const base=process.argv[2]||'http://localhost:3107';
const output=await mkdtemp(join(tmpdir(),'supalens-danger-settings-'));
const browser=await chromium.launch({headless:true});
let renders=0, interactions=0;
try {
  for(const locale of ['en','ko','ja']) for(const theme of ['light','dark']) {
    console.log(`Checking danger settings: ${locale}/${theme}`);
    const {appSettings:{danger:t},appCommon:common}=JSON.parse(await readFile(new URL(`../messages/${locale}.json`,import.meta.url),'utf8'));
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await context.addCookies([{name:'NEXT_LOCALE',value:locale,url:base}]);
    await context.addInitScript(value=>localStorage.setItem('theme',value),theme);
    const errors=[],unexpected=[];
    await context.route('**/*',route=>{
      const request=route.request(),url=request.url();
      if(!url.startsWith(base)&&!url.startsWith('https://fonts.'))return route.abort();
      if(url.startsWith(base)&&(request.method()!=='GET'||new URL(url).pathname.startsWith('/api/')||new URL(url).pathname.startsWith('/auth/'))){unexpected.push(url);return route.abort();}
      return route.continue();
    });
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>{errors.push('Unexpected native confirmation');void dialog.dismiss();});
    page.on('console',message=>{if(/MISSING_MESSAGE|INVALID_MESSAGE/.test(message.text()))errors.push(message.text());});
    const root=page.locator('[data-danger-zone]');
    const row=target=>root.locator(`[data-danger-action="${target}"]`);
    const label=target=>target==='org'?t.deleteOrg.button:t.deleteAccount.button;
    const calls=async()=>JSON.parse(await page.locator('[data-danger-calls]').textContent());
    const visit=async mode=>{
      const url=`${base}/dev/settings?view=danger-actions&mode=${mode}`;
      assert.equal((await page.goto(url)).status(),200,url);
      await page.evaluate(()=>document.fonts.ready);
    };
    const fit=async()=>{
      for(const width of [1440,768,390,320]){
        await page.setViewportSize({width,height:1000});
        await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
        if(await page.getByRole('dialog').count())await expect.poll(()=>page.getByRole('dialog').evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})).toBe(true);
        renders++;
      }
    };
    const arm=async target=>{
      await row(target).locator('input').fill(target==='org'?await page.locator('[data-danger-workspace]').textContent():t.deleteAccount.keyword);
      await row(target).getByRole('button',{name:label(target),exact:true}).click();
    };
    for(const mode of ['success','non-owner','long','empty-name']){
      await visit(mode);await fit();
      await expect(row('org')).toHaveCount(mode==='non-owner'?0:1);
      for(const field of await root.locator('input').all()){
        await expect(field).toHaveAccessibleName(/.+/);
        assert(await field.evaluate(node=>node.labels.length===1));
      }
      for(const button of await root.getByRole('button').all())await expect(button).toBeDisabled();
      assert.deepEqual(await calls(),[]);
      if(mode==='long'){
        await arm('org');await fit();
        await page.setViewportSize({width:320,height:640});
        const modal=page.getByRole('dialog');
        await expect(modal).toContainText(await page.locator('[data-danger-workspace]').textContent());
        await modal.getByRole('button',{name:label('org'),exact:true}).focus();
        assert(await modal.getByRole('button',{name:label('org'),exact:true}).evaluate(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));
        await page.screenshot({path:join(output,`${locale}-${theme}-long-dialog-320.png`),fullPage:true});
        await page.keyboard.press('Escape');await expect(row('org').getByRole('button')).toBeFocused();interactions++;
      }
    }
    for(const target of ['org','account'])for(const mode of ['success','denied','subscription','unconfigured','unauthorized','failed','throw','malformed','partial','final-step','pending','handoff-failure',...(target==='account'?['signout-failure','signout-pending']:[])]){
      await visit(mode);await page.setViewportSize({width:1440,height:1000});
      const trigger=row(target).getByRole('button',{name:label(target),exact:true});
      await row(target).locator('input').fill('wrong confirmation');
      await expect(trigger).toBeDisabled();await trigger.evaluate(button=>button.click());
      await expect(page.getByRole('dialog')).toHaveCount(0);assert.deepEqual(await calls(),[]);
      await arm(target);
      const dialog=page.getByRole('dialog');
      await expect(dialog).toHaveAccessibleName(label(target));
      assert.deepEqual(await calls(),[]);
      await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
      await trigger.click();await fit();
      await dialog.getByRole('button',{name:label(target),exact:true}).click();
      if(mode==='pending'){
        await expect(dialog.getByRole('status')).toHaveText(target==='org'?t.deleteOrg.deleting:t.deleteAccount.processing);
        await expect(dialog.getByRole('button',{name:common.processing,exact:true})).toBeDisabled();
        await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
        await dialog.getByRole('button',{name:common.processing,exact:true}).evaluate(button=>{button.click();button.click();});
        await expect(row(target).locator('button')).toHaveText(target==='org'?t.deleteOrg.deleting:t.deleteAccount.processing);
        await expect(row(target==='org'?'account':'org').locator('button')).toHaveText(label(target==='org'?'account':'org'));
      }
      const preflight=['denied','subscription','unconfigured','unauthorized'].includes(mode);
      const unknown=['failed','throw','malformed','partial','final-step'].includes(mode);
      if(preflight||unknown){
        const expected=preflight?t.review[mode==='denied'?target==='org'?'notOwner':'otherMembers':mode]
          :mode==='partial'&&target==='account'?t.review.teardown:mode==='final-step'&&target==='account'?t.review.finalStep:t.review.unknown;
        await expect(dialog.getByRole('alert')).toContainText(expected);
        if(unknown)await expect(dialog.getByRole('button',{name:label(target),exact:true})).toBeDisabled();
        await dialog.getByRole('button',{name:common.close,exact:true}).click();
        await expect(root.getByRole('alert')).toContainText(expected);
        await expect(row(target).locator('input')).toHaveValue(target==='org'?'Northstar':t.deleteAccount.keyword);
        if(unknown){
          await expect(root.getByRole('link',{name:t.review.reload,exact:true})).toHaveAttribute('href','/dev/settings?view=danger-actions&mode=success');
          for(const input of await root.locator('input').all())await expect(input).toBeDisabled();
          await expect(root.getByRole('alert')).toBeFocused();
        } else await expect(trigger).toBeEnabled();
        assert.deepEqual(await calls(),[{action:target,...(target==='org'?{orgId:'sample-A'}:{})}]);
      }else{
        await expect(dialog).toHaveCount(0);await expect(root.getByRole('status')).toContainText(t.review.confirmed);
        if(mode==='signout-pending'){
          await expect(root.getByText(t.review.finishing,{exact:true})).toBeVisible();
          for(const input of await root.locator('input').all())await expect(input).toBeDisabled();
        }
        if(['handoff-failure','signout-failure'].includes(mode)){
          await expect(root.getByText(t.review.handoffFailed,{exact:true})).toBeVisible();
          await root.getByRole('button',{name:t.review.continue,exact:true}).click();
        }
        await expect(root.getByText(t.review.handoffReady,{exact:true})).toBeVisible();
        const recorded=await calls();
        assert.equal(recorded.filter(value=>value?.action===target).length,1);
        assert.equal(recorded.filter(value=>value==='signout').length,target==='account'?mode==='signout-failure'?2:1:0);
        assert.equal(recorded.filter(value=>value===`navigate-${target}`).length,mode==='handoff-failure'?2:1);
        for(const input of await root.locator('input').all())await expect(input).toBeDisabled();
      }
      await expect(root).not.toContainText('private');await fit();interactions++;
      if(mode==='final-step'&&target==='account')await page.screenshot({path:join(output,`${locale}-${theme}-partial-320.png`),fullPage:true});
    }
    for(const target of ['org','account']){
      await visit('pending');await arm(target);
      await page.getByRole('dialog').getByRole('button',{name:label(target),exact:true}).click();
      await page.getByRole('button',{name:'Switch sample workspace',exact:true,includeHidden:true}).evaluate(button=>button.click());
      await expect(page.locator('[data-danger-workspace]')).toHaveText('Harbor');
      await page.waitForTimeout(1100);
      await expect(root.getByRole('alert')).toHaveCount(0);await expect(root.getByRole('status')).toHaveCount(0);
      assert.deepEqual(await calls(),[{action:target,...(target==='org'?{orgId:'sample-A'}:{})}]);interactions++;
    }
    await visit('success');await row('org').locator('input').fill('Northstar');
    await page.getByRole('button',{name:'Rename sample workspace',exact:true}).click();
    await expect(row('org').locator('input')).toHaveValue('');await expect(row('org').getByRole('button')).toBeDisabled();
    await page.getByRole('button',{name:'Remove sample ownership',exact:true}).click();await expect(row('org')).toHaveCount(0);
    assert.deepEqual(await calls(),[]);interactions++;
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
    await context.close();
  }
  console.log(JSON.stringify({renders,interactions,screenshots:output}));
}finally{await browser.close();}
