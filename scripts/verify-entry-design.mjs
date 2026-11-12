import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
const publicOnly = process.argv.includes('--public');
const output = await mkdtemp(join(tmpdir(), 'supalens-entry-design-'));
const browser = await chromium.launch({ headless: true });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    const { appAuth: t, pricing, faq } = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    const errors = [], unexpected = [];
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(base).origin && !/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return route.abort();
      if (url.origin === new URL(base).origin && (request.method() !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/'))) { unexpected.push(request.url()); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/MISSING_MESSAGE|INVALID_MESSAGE/.test(message.text())) errors.push(message.text()); });
    const visit = async path => {
      assert.equal((await page.goto(base + path)).status(), 200, path);
      await page.evaluate(() => document.fonts.ready);
      if (path.startsWith('/dev/entry')) await page.locator('[data-entry-ready="true"]').waitFor();
    };
    const fit = async () => {
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        renders++;
      }
    };
    const root = page.locator('[data-login-form]');
    const field = root.getByRole('textbox', { name: t.emailAria, exact: true });
    const label = method => method === 'email' ? t.sendLink : t[method === 'google' ? 'continueGoogle' : method === 'kakao' ? 'continueKakao' : 'continueGithub'];
    const calls = async () => JSON.parse(await page.locator('[data-login-calls]').textContent());
    const address = 'sample-address-'.repeat(4) + '@example.invalid';
    if (!publicOnly) {
      await visit('/dev/entry?mode=unconfigured'); await fit();
      await expect(page.locator('main').getByRole('alert')).toHaveText(t.login.errorNotConfigured);
      await expect(root).toHaveCount(0); assert.deepEqual(await calls(), []);
      for (const method of ['google', 'kakao', 'github', 'email']) for (const mode of ['success', 'failure', 'throw', 'malformed', 'pending', 'retry', 'rate-limit', 'invalid', 'unavailable']) {
        await visit(`/dev/entry?mode=${mode}`); await fit();
        const trigger = root.getByRole('button', { name: label(method), exact: true });
        await field.fill('not-an-email');
        await root.getByRole('button', { name: t.sendLink, exact: true }).click();
        assert.deepEqual(await calls(), [], 'Native email validation prevents transport');
        await field.fill(address);
        await trigger.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
        const controlStyle = await trigger.evaluate(el => ({ radius: getComputedStyle(el).borderRadius, outline: getComputedStyle(el).outlineStyle }));
        assert.equal(controlStyle.radius, '6px'); assert.equal(controlStyle.outline, 'solid');
        await trigger.click();
        if (mode === 'pending') {
          for (const control of await root.locator(':scope > button, form button, input').all()) await expect(control).toBeDisabled();
          await expect(root.locator(':scope > [role="status"]')).toHaveText(method === 'email' ? t.sending : t.review.redirectingProvider.replace('{provider}', method === 'google' ? 'Google' : method === 'kakao' ? 'Kakao' : 'GitHub'));
          await root.locator('form').evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
        }
        const notice = root.locator('[data-login-notice]');
        const acknowledged = mode === 'success' || mode === 'pending';
        const code = acknowledged ? method === 'email' ? 'emailAcknowledged' : 'redirectReady'
          : mode === 'rate-limit' ? 'rateLimited' : mode === 'invalid' ? 'invalidRequest' : mode === 'unavailable' ? 'unavailable' : method === 'email' ? 'emailUnknown' : 'redirectUnknown';
        await expect(notice).toContainText(t.review[code].replace('{email}', address));
        await expect(notice).toHaveAttribute('role', acknowledged ? 'status' : 'alert');
        assert(!(await root.textContent()).includes('Private simulated'));
        await fit();
        assert(await notice.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Long result text stays within the notice');
        const recorded = await calls(); assert.equal(recorded.length, 1); assert.equal(recorded[0].method, method);
        const redirect = new URL(recorded[0].redirectTo);
        assert.equal(redirect.origin, new URL(base).origin); assert.equal(redirect.pathname, '/auth/callback');
        assert.equal(redirect.searchParams.get('next'), '/app/settings/billing?plan=basic');
        if (method === 'email') assert.equal(recorded[0].email, address);
        if (acknowledged && method !== 'email') {
          await root.getByRole('button', { name: t.review.retry, exact: true }).click();
          await expect(trigger).toBeFocused(); await expect(trigger).toBeEnabled();
          assert.equal((await calls()).length, 1, 'Rearming does not make another auth request');
        } else await expect(trigger).toBeEnabled();
        if (mode === 'retry') {
          await trigger.click();
          await expect(notice).toContainText(t.review[method === 'email' ? 'emailAcknowledged' : 'redirectReady'].replace('{email}', address));
          assert.equal((await calls()).length, 2);
        }
        if (method === 'email' && ['success', 'failure'].includes(mode)) await page.screenshot({ path: join(output, `login-${mode}-${locale}-${theme}-320.png`), fullPage: true });
        interactions++;
      }
      for (const method of ['email', 'google']) {
        await visit('/dev/entry?mode=pending'); await field.fill(address);
        await root.getByRole('button', { name: label(method), exact: true }).click();
        await page.getByRole('button', { name: 'Change sample destination', exact: true }).click();
        await expect(field).toHaveValue('');
        await page.waitForTimeout(1100);
        await expect(root.locator('[data-login-notice]')).toHaveCount(0);
        assert.equal((await calls()).length, 1);
        interactions++;
      }
    }
    const prefix = locale === 'en' ? '' : `/${locale}`;
    for (const route of ['', '/supabase']) {
      await visit(prefix + route || '/');
      const section = page.getByRole('region', { name: pricing.head.title, exact: true });
      await expect(section.getByRole('article')).toHaveCount(4);
      for (const [index, name] of ['Free', 'Basic', 'Standard', 'Premium'].entries()) {
        const card = section.getByRole('article', { name, exact: true });
        await expect(card.getByRole('heading', { level: 3 })).toHaveText(name);
        await expect(card.getByText(['$0', '$89', '$299', '$899'][index], { exact: true })).toBeVisible();
        const link = card.getByRole('link', { name: `${name}: ${pricing.plans[index].cta}`, exact: true });
        const href = new URL(await link.getAttribute('href'), base);
        if (index) assert.equal(href.searchParams.get('next'), `/app/settings/billing?plan=${name.toLowerCase()}`);
        assert.equal(await link.evaluate(el => getComputedStyle(el).borderRadius), '6px');
      }
      await fit();
      const subtitle = section.getByText(pricing.head.subtitle, { exact: true });
      assert.equal(await subtitle.evaluate(el => getComputedStyle(el).fontSize), '17px');
      if (!route) {
        const questions = page.locator('#faq');
        await expect(questions).toHaveAccessibleName(faq.title);
        for (const item of faq.items) {
          const trigger = questions.getByRole('button', { name: item.q, exact: true });
          await trigger.focus(); await page.keyboard.press('Enter');
          await expect(trigger).toHaveAttribute('aria-expanded', 'true');
          await expect(questions.getByRole('region')).toHaveCount(1);
          await expect(questions.getByRole('region')).toHaveText(item.a);
          assert.equal(await trigger.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
          await fit(); interactions++;
        }
        await questions.getByRole('button').last().press('Space');
        await expect(questions.getByRole('region')).toHaveCount(0);
        await section.screenshot({ path: join(output, `pricing-${locale}-${theme}-320.png`) });
      }
    }
    for (const error of ['', 'auth_failed', 'missing_code', 'not_configured', 'constructor']) {
      await visit(`/login?next=${encodeURIComponent('/app/settings/billing?plan=basic')}${error ? `&error=${error}` : ''}`);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      if (error) await expect(page.locator('main').getByRole('alert')).toHaveText(t.login[error === 'auth_failed' ? 'errorAuthFailed' : error === 'missing_code' ? 'errorMissingCode' : error === 'not_configured' ? 'errorNotConfigured' : 'errorGeneric']);
      for (const path of ['/terms', '/privacy']) await expect(page.locator(`a[href="${prefix}${path}"]`)).toHaveCount(1);
      await fit();
    }
    for (const path of ['/terms', '/privacy', '']) {
      const href = prefix + path || '/';
      await page.locator(`main a[href="${href}"]`).filter({ visible: true }).first().click();
      await expect(page).toHaveURL(new URL(href, base).href);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await page.goBack();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.login.title);
      interactions++;
    }
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await context.close(); console.log(`PASS entry ${locale}/${theme}`);
  }
  console.log(JSON.stringify({ renders, interactions, screenshots: output }, null, 2));
} finally { await browser.close(); }
