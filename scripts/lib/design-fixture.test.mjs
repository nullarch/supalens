import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guardDesignFixture, localFixtureOrigin } from './design-fixture.mjs';

test('fixture origin accepts only a bare local HTTP origin', () => {
  for (const origin of ['http://localhost:3107', 'http://127.0.0.1:3107', 'http://[::1]:3107']) {
    assert.equal(localFixtureOrigin(origin), origin);
    assert.equal(localFixtureOrigin(`${origin}/`), origin);
  }
  assert.equal(localFixtureOrigin(), 'http://localhost:3107');
  for (const origin of ['https://supalens.ai', 'http://localhost.example.com', 'http://localhost:3107/dev/settings',
    'http://localhost:3107?mode=success', 'http://localhost:3107#preview', 'http://user:password@localhost:3107',
    'https://localhost:3107', 'file:///tmp/preview.html']) assert.throws(() => localFixtureOrigin(origin));
});

test('fixture guard blocks all writes and local API reads, including deceptive origins', async () => {
  let handler;
  const unexpected = [];
  await guardDesignFixture({ route: async (_pattern, callback) => { handler = callback; } }, 'http://localhost:3107', unexpected);
  const cases = [
    ['http://localhost:3107/dev/settings?view=mcp-actions', 'GET', 'continue', false],
    ['http://localhost:3107/_next/static/test.css', 'GET', 'continue', false],
    ['http://localhost:3107/api/keys', 'GET', 'abort', true],
    ['http://localhost:3107/dev/settings', 'POST', 'abort', true],
    ['http://localhost:3107/api/keys', 'DELETE', 'abort', true],
    ['http://localhost:31070/api/keys', 'GET', 'abort', false],
    ['https://fonts.googleapis.com/css2?family=Inter', 'GET', 'continue', false],
    ['https://fonts.gstatic.com/sample.woff2', 'GET', 'continue', false],
    ['https://fonts.googleapis.com/css2', 'POST', 'abort', true],
    ['https://fonts.googleapis.com.example.com/track', 'GET', 'abort', false],
    ['https://www.googletagmanager.com/gtag/js?id=undefined', 'GET', 'abort', false],
    ['https://hooks.slack.com/sample-only', 'POST', 'abort', true],
  ];
  for (const [url, method, expected, reported] of cases) {
    let result;
    const previous = unexpected.length;
    await handler({ request: () => ({ url: () => url, method: () => method }),
      abort: () => { result = 'abort'; }, continue: () => { result = 'continue'; } });
    assert.equal(result, expected, `${method} ${url}`);
    assert.equal(unexpected.length - previous, reported ? 1 : 0);
  }
});
