// Maintenance only. Image requests never download fonts or send text to a font service.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const commit = '523d033d6cb47f4a80c58a35753646f5c3608a78'; // Noto Sans CJK 2.004
const base = `https://raw.githubusercontent.com/notofonts/noto-cjk/${commit}/Sans`;
const directory = resolve('assets/fonts/share');
await mkdir(directory, { recursive: true });
const sources = ['SubsetOTF/KR/NotoSansKR-Regular.otf', 'SubsetOTF/KR/NotoSansKR-Bold.otf', 'SubsetOTF/JP/NotoSansJP-Regular.otf', 'SubsetOTF/JP/NotoSansJP-Bold.otf', 'LICENSE'].map(source => ({
  name: source.split('/').at(-1), url: source === 'LICENSE' ? `${base}/../LICENSE` : `${base}/${source}`,
}));
const emojiBase = 'https://raw.githubusercontent.com/googlefonts/noto-emoji/9a5261d871451f9b5183c93483cbd68ed916b1e9/fonts';
sources.push({ name: 'NotoEmoji-Regular.ttf', url: `${emojiBase}/NotoEmoji-Regular.ttf` }, { name: 'EMOJI-LICENSE', url: `${emojiBase}/LICENSE` });
for (const { name, url } of sources) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Font source failed: ${name} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const destination = resolve(directory, name);
  const existing = await readFile(destination).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (existing && !existing.equals(bytes)) throw new Error(`Refusing to overwrite changed asset: ${name}`);
  if (!existing) await writeFile(destination, bytes, { flag: 'wx' });
  console.log(`${createHash('sha256').update(bytes).digest('hex')}  ${name}  ${bytes.length} bytes`);
}
