// Renders docs/assets/demo.gif, demo.mp4 and banner.png from demo.html and banner.html in this folder.
// Run from the repository root:   node docs/assets/src/render.mjs
// Needs Google Chrome (driven through the repo's @playwright/test, channel "chrome") and ffmpeg on PATH.
// Options: --out <dir> (default: docs/assets)  --fps 15  --width 800  --only demo|banner  --keep-frames
// The animation is a pure function of time (window.__setTime), so every run produces the same frames.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const out = resolve(arg("out", join(here, "..")));
const fps = Number(arg("fps", 15));
const width = Number(arg("width", 800));
const only = arg("only", "");
const framesDir = arg("frames", "") ? resolve(arg("frames")) : mkdtempSync(join(tmpdir(), "supalens-demo-"));
mkdirSync(out, { recursive: true });
mkdirSync(framesDir, { recursive: true });

// @playwright/test lives in the repository's node_modules; PLAYWRIGHT_FROM overrides the lookup root.
function loadPlaywright() {
  const roots = [process.env.PLAYWRIGHT_FROM, here, process.cwd()].filter(Boolean);
  for (const root of roots) {
    try {
      return createRequire(join(resolve(root), "package.json"))("@playwright/test");
    } catch {}
  }
  throw new Error("Cannot find @playwright/test — run from the repository root after `npm install`.");
}
const { chromium } = loadPlaywright();
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
const size = (f) => `${(statSync(f).size / 1024).toFixed(0)} KB`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  if (only !== "banner") {
    const page = await browser.newPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(join(here, "demo.html")).href + "?render=1");
    await page.waitForFunction(() => window.__ready === true);
    const duration = await page.evaluate(() => window.__duration);
    const count = Math.round((duration / 1000) * fps);
    for (let i = 0; i < count; i++) {
      await page.evaluate((ms) => window.__setTime(ms), (i * 1000) / fps);
      await page.screenshot({ path: join(framesDir, `f${String(i).padStart(4, "0")}.png`) });
      if (i % 60 === 0) console.log(`frame ${i}/${count}`);
    }
    await page.close();

    const input = ["-framerate", String(fps), "-i", join(framesDir, "f%04d.png")];
    const palette = join(framesDir, "palette.png");
    const scale = `scale=${width}:-1:flags=lanczos`;
    ffmpeg(...input, "-vf", `${scale},palettegen=max_colors=256:stats_mode=diff`, palette);
    ffmpeg(...input, "-i", palette, "-lavfi", `${scale}[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle`, "-loop", "0", join(out, "demo.gif"));
    ffmpeg(...input, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "slow", "-movflags", "+faststart", "-an", join(out, "demo.mp4"));
    console.log(`demo.gif ${size(join(out, "demo.gif"))} · demo.mp4 ${size(join(out, "demo.mp4"))} · ${count} frames · ${duration / 1000}s @ ${fps}fps`);
  }

  if (only !== "demo" && existsSync(join(here, "banner.html"))) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(join(here, "banner.html")).href);
    await page.waitForFunction(() => window.__ready === true);
    const raw = join(framesDir, "banner-raw.png");
    await page.screenshot({ path: raw });
    await page.close();
    // quantised to a 256-colour palette: a flat-colour UI composition loses nothing visible and shrinks ~4x
    ffmpeg("-i", raw, "-vf", "split[a][b];[a]palettegen=max_colors=256:stats_mode=single[p];[b][p]paletteuse=dither=none", join(out, "banner.png"));
    console.log(`banner.png ${size(join(out, "banner.png"))}`);
  }
} finally {
  await browser.close();
  if (!flag("keep-frames") && !arg("frames", "")) rmSync(framesDir, { recursive: true, force: true });
}
