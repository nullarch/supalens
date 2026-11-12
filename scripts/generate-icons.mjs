// Renders the existing three-circle Supalens mark on neutral tiles consumed by
// Next.js file conventions:
//   - src/app/favicon.ico   (16x16 + 32x32 PNG-in-ICO, rounded neutral tile)
//   - src/app/apple-icon.png (180x180, full-bleed square neutral tile)
//
// Rendering is done with a headless Chromium (via @playwright/test) so the SVG
// is rasterized exactly as a browser would paint it. The ICO container is
// packed by hand (Node has no native ICO writer).
//
// Run: npm run icons:gen

import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BRAND = join(__dirname, 'brand');
const APP = join(ROOT, 'src', 'app');

const ROUNDED_SVG = join(BRAND, 'icon-tile-rounded.svg');
const SQUARE_SVG = join(BRAND, 'icon-tile-square.svg');

/**
 * Rasterize an SVG file to a PNG buffer of exactly `size` x `size` pixels.
 * The SVG is inlined into a margin-0 HTML shell and forced to size x size via
 * CSS; the viewport matches, so a plain (non-fullPage) screenshot is exactly
 * size x size at devicePixelRatio 1. omitBackground keeps the area outside the
 * (rounded) tile transparent.
 */
async function renderSvgToPng(browser, svgPath, size) {
  const svg = readFileSync(svgPath, 'utf8');
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  try {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      *{margin:0;padding:0;box-sizing:border-box}
      html,body{width:${size}px;height:${size}px;background:transparent;overflow:hidden}
      svg{display:block;width:${size}px;height:${size}px}
    </style></head><body>${svg}</body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    return await page.screenshot({ omitBackground: true });
  } finally {
    await page.close();
  }
}

/**
 * Pack one or more PNG buffers into a single .ico container.
 * Layout: ICONDIR header (6 bytes) + one 16-byte ICONDIRENTRY per image +
 * the raw PNG payloads back-to-back.
 * @param {{width:number,height:number,png:Buffer}[]} images
 */
function packIco(images) {
  const count = images.length;

  // ICONDIR: reserved(0) u16le, type(1=icon) u16le, count u16le
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const ENTRY_SIZE = 16;
  let offset = header.length + count * ENTRY_SIZE; // first image payload offset

  const entries = [];
  for (const img of images) {
    const e = Buffer.alloc(ENTRY_SIZE);
    e.writeUInt8(img.width >= 256 ? 0 : img.width, 0); // width  (0 => 256)
    e.writeUInt8(img.height >= 256 ? 0 : img.height, 1); // height (0 => 256)
    e.writeUInt8(0, 2); // color palette count (0 = no palette)
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(img.png.length, 8); // size of image data
    e.writeUInt32LE(offset, 12); // offset of image data from file start
    entries.push(e);
    offset += img.png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

async function launchChromium() {
  try {
    return await chromium.launch();
  } catch (err) {
    console.warn(`chromium launch failed (${err.message}); installing browser…`);
    execSync('npx playwright install chromium', { stdio: 'inherit' });
    return await chromium.launch();
  }
}

/** Parse a PNG's IHDR width/height and assert its 8-byte signature. */
function pngDims(buf, base = 0) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < SIG.length; i++) {
    if (buf[base + i] !== SIG[i]) throw new Error(`bad PNG signature at offset ${base}`);
  }
  return { width: buf.readUInt32BE(base + 16), height: buf.readUInt32BE(base + 20) };
}

function hex(buf, n) {
  return [...buf.subarray(0, n)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

/** Re-read the emitted files and print structural checks. */
function verify() {
  console.log('\n--- verification ---');

  const ico = readFileSync(join(APP, 'favicon.ico'));
  const first6 = hex(ico, 6);
  const headerOk =
    ico[0] === 0x00 && ico[1] === 0x00 && ico[2] === 0x01 &&
    ico[3] === 0x00 && ico[4] === 0x02 && ico[5] === 0x00;
  console.log(`favicon.ico: ${ico.length} bytes`);
  console.log(`  first 6 bytes: ${first6}  ${headerOk ? 'OK (00 00 01 00 02 00)' : 'MISMATCH'}`);

  const count = ico.readUInt16LE(4);
  for (let n = 0; n < count; n++) {
    const entry = 6 + n * 16;
    const bytesInRes = ico.readUInt32LE(entry + 8);
    const imageOffset = ico.readUInt32LE(entry + 12);
    const isPng =
      ico[imageOffset] === 0x89 && ico[imageOffset + 1] === 0x50 &&
      ico[imageOffset + 2] === 0x4e && ico[imageOffset + 3] === 0x47;
    const { width, height } = pngDims(ico, imageOffset);
    const small = bytesInRes < 20 * 1024;
    console.log(
      `  image[${n}] offset=${imageOffset} bytes=${bytesInRes} ` +
        `PNG=${isPng ? 'yes' : 'NO'} IHDR=${width}x${height} sizeOk=${small}`,
    );
  }

  const apple = readFileSync(join(APP, 'apple-icon.png'));
  const isPng =
    apple[0] === 0x89 && apple[1] === 0x50 && apple[2] === 0x4e && apple[3] === 0x47;
  const { width, height } = pngDims(apple);
  console.log(
    `apple-icon.png: ${apple.length} bytes PNG=${isPng ? 'yes' : 'NO'} ` +
      `IHDR=${width}x${height} sizeOk=${apple.length < 20 * 1024}`,
  );
}

async function main() {
  const browser = await launchChromium();
  try {
    // favicon.ico — rounded tile at 16 and 32, packed as PNG-in-ICO.
    const png16 = await renderSvgToPng(browser, ROUNDED_SVG, 16);
    const png32 = await renderSvgToPng(browser, ROUNDED_SVG, 32);
    const ico = packIco([
      { width: 16, height: 16, png: png16 },
      { width: 32, height: 32, png: png32 },
    ]);
    writeFileSync(join(APP, 'favicon.ico'), ico);
    console.log(`wrote src/app/favicon.ico (${ico.length} bytes; 16x16 ${png16.length}B + 32x32 ${png32.length}B)`);

    // apple-icon.png — full-bleed square tile at 180.
    const png180 = await renderSvgToPng(browser, SQUARE_SVG, 180);
    writeFileSync(join(APP, 'apple-icon.png'), png180);
    console.log(`wrote src/app/apple-icon.png (${png180.length} bytes; 180x180)`);
  } finally {
    await browser.close();
  }

  verify();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
