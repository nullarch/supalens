import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

/** These checks must never point at a deployed service or an authenticated API. */
export function localFixtureOrigin(value = 'http://localhost:3107') {
  const target = new URL(value);
  assert.ok(target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
    && target.pathname === '/' && !target.search && !target.hash && !target.username && !target.password,
    'Use an explicit local development origin only');
  return target.origin;
}

export async function guardDesignFixture(context, base, unexpected) {
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== 'GET' || (url.origin === base && url.pathname.startsWith('/api/'))) {
      unexpected.push(request.url());
      return route.abort();
    }
    if (url.origin === base) return route.continue();
    if (url.protocol === 'https:' && ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
    // The root layout requests analytics and a legacy font stylesheet. Suppress
    // these, and every other external non-font request, without sending it.
    return route.abort();
  });
}

/** Check the actual clickable element; checkbox callers pass its wrapping label. */
export async function assertControlTargets(page, selector) {
  await expect.poll(() => page.locator(selector).evaluateAll(nodes => nodes.flatMap(node => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)
      ? [{ name: node.getAttribute('aria-label') || node.textContent, width: rect.width, height: rect.height }] : [];
  })), { message: 'Controls retain 44px targets' }).toEqual([]);
}
