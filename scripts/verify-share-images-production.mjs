// Runs a built server with privileged data access explicitly disabled. No real
// token, auth cookie, grant, share creation or database query is used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const port = Number(process.argv[2] || 3112);
assert(Number.isInteger(port) && port > 1024 && port < 65536);
// Match the listener hostname and request hostname for Next's locale redirects.
const base = `http://localhost:${port}`;
const metadataOrigin = new URL(process.argv[3] || 'https://www.supalens.ai').origin;
const output = await mkdtemp(join(tmpdir(), 'supalens-share-production-'));
const traceRoot = resolve('.next/server/app/share');
const traceFiles = (await readdir(traceRoot, { recursive: true })).filter(file => file.includes('opengraph-image') && file.endsWith('route.js.nft.json'));
assert.equal(traceFiles.length, 1, 'Exactly one built metadata image handler');
const traceFile = join(traceRoot, traceFiles[0]);
const traced = JSON.parse(await readFile(traceFile, 'utf8')).files.map(file => resolve(dirname(traceFile), file));
const assets = (await readdir('assets/fonts/share')).filter(file => /\.(otf|ttf)$|LICENSE$/.test(file));
assert.equal(assets.length, 7);
for (const file of assets) assert(traced.includes(resolve('assets/fonts/share', file)), `Missing traced font/license: ${file}`);
assert(traced.some(file => /resvgjs\..+\.node$/.test(file)), 'Missing native renderer in deployment trace');
assert(traced.some(file => file.endsWith('/harfbuzzjs/hb.wasm')), 'Missing font-shaper WASM in deployment trace');

// Refuse to reuse another listener: the checks must target our no-admin process.
const { createServer } = await import('node:net');
const probe = createServer();
await new Promise((accept, reject) => { probe.once('error', reject); probe.listen(port, 'localhost', accept); });
await new Promise(accept => probe.close(accept));
const child = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', 'localhost', '--port', String(port)], {
  env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: '', SENTRY_DSN: '' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', data => { logs += data.toString(); });
child.stderr.on('data', data => { logs += data.toString(); });
const exit = new Promise(accept => child.once('exit', accept));
const root = '/share/design-verification-no-admin';
let images = 0, metadataChecks = 0;
try {
  for (let attempt = 0; !logs.includes('Ready in'); attempt++) {
    if (child.exitCode !== null || attempt >= 200) throw new Error('Isolated production server did not start');
    await delay(100);
  }
  for (const locale of ['en', 'ko', 'ja']) {
    // Even a conflicting cookie cannot change an explicit image ID's locale.
    let first;
    for (const cookie of ['', 'NEXT_LOCALE=ko', 'NEXT_LOCALE=ja']) {
      const response = await fetch(`${base}${root}/opengraph-image/${locale}`, { headers: cookie ? { cookie } : {} });
      assert.equal(response.status, 200, `Image ${locale}: ${response.status}`);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.match(response.headers.get('cache-control') || '', /no-store/);
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
      const png = Buffer.from(await response.arrayBuffer());
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
      if (first) assert(png.equals(first), 'Cookie changed a stable localized image');
      else { first = png; await writeFile(join(output, `${locale}.png`), png); }
      images++;
    }
    const response = await fetch(`${base}${root}`, { headers: { cookie: `NEXT_LOCALE=${locale}`, 'user-agent': 'Twitterbot' } });
    assert.equal(response.status, 404, 'With admin disabled this sample page must remain not found');
    const html = await response.text();
    const urls = [...html.matchAll(/<meta property="og:image" content="([^"]+)"/g)].map(match => match[1]);
    assert.equal(urls.length, 3);
    for (const url of urls) assert.equal(new URL(url).origin, metadataOrigin, 'Incorrect public image origin');
    assert(urls[0].includes(`/opengraph-image/${locale}`), 'Preferred locale is not first in metadata');
    for (const id of ['en', 'ko', 'ja']) assert(urls.some(url => url.includes(`/opengraph-image/${id}`)));
    assert(html.includes('name="twitter:image"'), 'Twitter image wiring missing');
    metadataChecks++;
  }
  const unknown = await fetch(`${base}${root}/opengraph-image/unsupported`);
  assert.equal(unknown.status, 404);
  const legacy = await fetch(`${base}${root}/opengraph-image`);
  assert.equal(legacy.status, 200, 'Legacy image URLs must still work');
  assert(Buffer.from(await legacy.arrayBuffer()).equals(await readFile(join(output, 'en.png'))));
  await new Promise((accept, reject) => {
    const metadata = spawn(process.execPath, [resolve('scripts/verify-public-metadata.mjs'), base, metadataOrigin], { stdio: 'inherit' });
    metadata.on('error', reject);
    metadata.on('exit', code => code === 0 ? accept() : reject(new Error(`Public metadata gate exited ${code}`)));
  });
  await new Promise((accept, reject) => {
    const gate = spawn(process.execPath, [resolve('scripts/verify-production-design-gates.mjs'), base], { stdio: 'inherit' });
    gate.on('error', reject);
    gate.on('exit', code => code === 0 ? accept() : reject(new Error(`Production gate exited ${code}`)));
  });
} finally {
  child.kill('SIGTERM');
  await exit;
  await writeFile(join(output, 'server.log'), logs);
}
console.log(JSON.stringify({ images, metadataChecks, tracedAssets: assets.length, nativeRenderer: true, unknownId: 404, legacyUrl: 200, admin: 'disabled', output }));
