// Pure renderer + actual route with local adapters only; never looks up a share token.
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const output = await mkdtemp(join(tmpdir(), 'supalens-share-images-'));
await new Promise((accept, reject) => {
  const child = spawn(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', 'src/lib/share/image.test.ts', 'src/lib/share/image-route.test.ts'], {
    stdio: 'inherit', env: { ...process.env, SHARE_IMAGE_ARTIFACT_DIR: output },
  });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? accept() : reject(new Error(`Share image tests exited ${code}`)));
});
const images = (await readdir(output)).filter(file => /^[a-z]+-[a-z]+\.png$/.test(file)).sort();
assert.equal(images.length, 24);
const gallery = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Supalens · 공유 이미지 디자인 검증</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f6f7;color:#191c20;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;padding:48px 24px}main{max-width:1240px;margin:auto}h1{font-size:clamp(28px,4vw,44px);letter-spacing:-1px}p{line-height:1.7;color:#5e646d}section{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin-top:36px}figure{margin:0;min-width:0}img{display:block;width:100%;height:auto;border:1px solid #e2e5e8;border-radius:8px}figcaption{padding:12px 0;font-size:14px}a{color:inherit}a:focus-visible{outline:2px solid #191c20;outline-offset:4px}@media(max-width:760px){section{grid-template-columns:1fr}body{padding:24px 16px}}</style><main><p>SUPALENS / GLOBAL PRODUCT DIRECTION</p><h1>공유되는 순간에도,<br>같은 브랜드.</h1><p>실제 이미지 렌더러 · 영어 / 한국어 / 일본어 · 1200 × 630 px<br>모든 질문·답변은 검증용 샘플입니다. 고객 데이터·계정·외부 API에 연결하지 않습니다.</p><p>중립 배경과 코퍼 로고, 질문 → 답변 발췌 순서. 긴 내용은 생략되며 전체 맥락은 원래 공유 페이지에 남습니다.<br>내장 폰트 범위 밖 문자·이모지는 대체 글리프로 표시될 수 있습니다. 외부 폰트 요청으로 보완하지 않습니다.</p><section>${images.map(file => `<figure><a href="${file}"><img src="${file}" width="1200" height="630" alt="검증 샘플 ${file.replace('.png', '')}"></a><figcaption>${file.replace('.png', '')} · sample only</figcaption></figure>`).join('')}</section></main></html>`;
await writeFile(join(output, 'index.html'), gallery);
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    assert.equal(new URL(route.request().url()).protocol, 'file:', 'Gallery must not fetch external resources');
    return route.continue();
  });
  await page.goto(pathToFileURL(join(output, 'index.html')).href);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.locator('img').evaluateAll(nodes => nodes.every(img => img.complete && img.naturalWidth === 1200 && img.naturalHeight === 630)), true);
  }
  await page.screenshot({ path: join(output, 'gallery-desktop.png') });
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
console.log(JSON.stringify({ images: images.length, galleryViewportChecks: 4, output, gallery: join(output, 'index.html') }));
