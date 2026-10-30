/**
 * Generates the store images (screenshots + promo tiles) from the real popup UI.
 *
 *   npm run store:assets      → writes PNGs to store/
 *
 * It loads the e2e build into Chromium, plays a test tone on a local page, puts the popup into
 * each state, captures it, then lays it out on a 1280×800 / 440×280 / 1400×560 canvas.
 * The site names shown in the popup header are set for the pictures; everything else is real UI.
 */
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, '.output/chrome-mv3-e2e');
const OUT = path.join(ROOT, 'store');
const PORT = 8766;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const posFor = (g, max = 2) => Math.round(g <= 1 ? Math.pow(g, 1 / 1.6) * 600 : 600 + ((g - 1) / (max - 1)) * 400);

function toneWav(seconds = 30, rate = 22050) {
  const n = seconds * rate, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(0.05 * 32767 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
  return b;
}
const wav = toneWav();
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/tone.wav')) return res.writeHead(200, { 'content-type': 'audio/wav' }).end(wav);
  res.writeHead(200, { 'content-type': 'text/html' })
    .end(`<!doctype html><button id=b onclick="a.play()">play</button><audio id=a src="/tone.wav" loop></audio>`);
});

const ICON = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'public/icon/128.png')).toString('base64');

// ---------- Layouts ----------
const css = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
  .canvas { position: relative; overflow: hidden; display: flex; align-items: center;
    background: radial-gradient(1200px 700px at 85% 20%, #3b82f6 0%, #1d4ed8 45%, #172554 100%); color: #fff; }
  .canvas.dark { background: radial-gradient(1200px 700px at 85% 20%, #3f3f46 0%, #18181b 60%, #09090b 100%); }
  .copy h1 { font-weight: 800; letter-spacing: -0.025em; line-height: 1.05; }
  .copy p { color: #dbeafe; line-height: 1.4; }
  .dark .copy p { color: #d4d4d8; }
  .copy ul { list-style: none; padding: 0; color: #eff6ff; }
  .copy li { display: flex; gap: 12px; align-items: baseline; }
  .copy li::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #fb923c; flex: none; transform: translateY(-2px); }
  .brand { display: flex; align-items: center; gap: 12px; font-weight: 700; }
  .shot { border-radius: 14px; box-shadow: 0 30px 80px rgba(2,6,23,.55), 0 0 0 1px rgba(255,255,255,.08); display: block; }
`;
const screenshotHtml = ({ title, sub, bullets = [], img, dark }) => `<!doctype html><style>${css}
  .canvas { width: 1280px; height: 800px; padding: 0 88px; gap: 72px; }
  .copy { flex: 1; } .copy h1 { font-size: 60px; } .copy p { font-size: 24px; margin-top: 20px; }
  .copy ul { margin-top: 28px; font-size: 21px; } .copy li { margin-bottom: 12px; }
  .brand { font-size: 20px; margin-bottom: 36px; opacity: .95; }
  .shot { width: 400px; }
</style><div class="canvas ${dark ? 'dark' : ''}">
  <div class="copy"><div class="brand"><img src="${ICON}" width="36" height="36">Site Volume</div>
    <h1>${title}</h1><p>${sub}</p>${bullets.length ? `<ul>${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>` : ''}</div>
  <img class="shot" src="${img}"></div>`;
const smallTileHtml = () => `<!doctype html><style>${css}
  .canvas { width: 440px; height: 280px; padding: 0 32px; }
  .brand { font-size: 30px; gap: 14px; } .copy p { font-size: 18px; margin-top: 14px; }
</style><div class="canvas"><div class="copy"><div class="brand"><img src="${ICON}" width="56" height="56">Site Volume</div>
  <p>Remember &amp; boost volume<br>for every website</p></div></div>`;
const marqueeHtml = (img) => `<!doctype html><style>${css}
  .canvas { width: 1400px; height: 560px; padding: 0 96px; gap: 80px; }
  .copy { flex: 1; } .copy h1 { font-size: 58px; } .copy p { font-size: 24px; margin-top: 18px; }
  .brand { font-size: 22px; margin-bottom: 28px; }
  .shot { width: 330px; margin-top: 140px; align-self: flex-start; }
</style><div class="canvas"><div class="copy"><div class="brand"><img src="${ICON}" width="40" height="40">Site Volume</div>
  <h1>Every site at the right volume.<br>Automatically.</h1><p>Boost up to 600% · Full screen still works · No ads, no tracking</p></div>
  <img class="shot" src="${img}"></div>`;

(async () => {
  if (!fs.existsSync(path.join(EXT, 'manifest.json'))) throw new Error(`Build first: npx wxt build --mode e2e`);
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(PORT, r));
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'sv-')), {
    headless: true, channel: 'chromium',
    deviceScaleFactor: 2, // hi-DPI popup captures keep the composites crisp
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
    const extId = sw.url().split('/')[2];
    await sleep(800);
    for (const p of ctx.pages()) if (p.url().includes('welcome')) await p.close();
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    await page.click('#b');
    await sleep(800);
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'http://localhost/*' }))[0].id);

    /** Capture the popup in a given state as a PNG data URL. */
    async function capturePopup({ host, level, remember = true, others = [], dark = false, after }) {
      const p = await ctx.newPage();
      await p.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
      await p.setViewportSize({ width: 320, height: 600 });
      await p.addInitScript(({ tid, host, remember, others }) => {
        const q = chrome.tabs.query.bind(chrome.tabs);
        chrome.tabs.query = async (o = {}) => {
          if (o.active) return [{ ...(await chrome.tabs.get(tid)), url: `https://${host}/`, favIconUrl: undefined }];
          if (o.audible) return others.map((t, i) => ({ id: 900000 + i, title: t.title, url: `https://${t.host}/`, audible: true, mutedInfo: { muted: false } }));
          if (o.muted) return [];
          return q(o);
        };
        const c = chrome.permissions.contains.bind(chrome.permissions);
        chrome.permissions.contains = async (x) => (remember ? true : c(x));
      }, { tid: tabId, host, remember, others });
      // Seed real state through the extension's own messages and storage.
      await sw.evaluate(async ({ host, level, remember, others }) => {
        const items = {};
        if (remember) items[`site:${host}`] = level;
        for (const t of others) items[`site:${t.host}`] = { v: t.v, m: false };
        await chrome.storage.sync.clear();
        await chrome.storage.sync.set(items);
      }, { host, level, remember, others });
      await p.goto(`chrome-extension://${extId}/popup.html`);
      await sleep(400);
      await p.evaluate(({ tid, level }) => chrome.runtime.sendMessage({ type: 'popup:set', tabId: tid, level, remember: false }), { tid: tabId, level });
      await p.reload();
      await sleep(900);
      await p.evaluate(() => document.activeElement?.blur());
      if (after) await after(p);
      await sleep(200);
      const h = await p.evaluate(() => Math.ceil(document.querySelector('main').getBoundingClientRect().height));
      await p.setViewportSize({ width: 320, height: h });
      const buf = await p.screenshot({ scale: 'device', clip: { x: 0, y: 0, width: 320, height: h } });
      await p.close();
      return 'data:image/png;base64,' + buf.toString('base64');
    }

    async function render(html, file, width, height) {
      const p = await ctx.newPage();
      await p.setViewportSize({ width, height });
      await p.setContent(html);
      await sleep(300);
      await p.screenshot({ path: path.join(OUT, file), scale: 'css', clip: { x: 0, y: 0, width, height } });
      await p.close();
      console.log('wrote', file);
    }

    const shotRemember = await capturePopup({ host: 'youtube.com', level: { v: 1.5, m: false } });
    const shotBoost = await capturePopup({
      host: 'bbc.co.uk', level: { v: 2, m: false },
      after: (p) => p.evaluate(() => { document.getElementById('unlock').click(); }),
    });
    const shotOthers = await capturePopup({
      host: 'youtube.com', level: { v: 1.2, m: false },
      others: [
        { title: 'Lo-fi beats to study to', host: 'soundcloud.com', v: 0.6 },
        { title: 'Morning news live', host: 'bbc.co.uk', v: 1.4 },
      ],
    });
    const shotEven = await capturePopup({ host: 'twitch.tv', level: { v: 1, m: false, c: true } });
    const shotDark = await capturePopup({
      host: 'soundcloud.com', level: { v: 1.8, m: false }, dark: true,
    });

    await render(screenshotHtml({
      title: 'Set it once.<br>It remembers.',
      sub: 'Give every website its own volume. Site Volume applies it automatically each time you visit.',
      bullets: ['Quieter music sites, louder lectures', 'Remembered per site, synced across your computers', 'One click to mute a site for good'],
      img: shotRemember,
    }), '1-remember.png', 1280, 800);
    await render(screenshotHtml({
      title: 'Boost quiet videos<br>without the crackle',
      sub: 'Up to 200% out of the box, 600% if you need it. A built-in limiter keeps boosted sound clean.',
      bullets: ['Full screen still works', 'Smooth slider, presets, scroll wheel and keyboard', 'Level shown on the toolbar icon'],
      img: shotBoost,
    }), '2-boost.png', 1280, 800);
    await render(screenshotHtml({
      title: 'Control every tab<br>from one place',
      sub: 'See which tabs are playing sound. Adjust, mute or jump to them without switching.',
      img: shotOthers,
    }), '3-other-tabs.png', 1280, 800);
    await render(screenshotHtml({
      title: 'Even out loud ads<br>and quiet speech',
      sub: 'One tick brings loud and quiet parts closer together, so you stop reaching for the volume.',
      img: shotEven,
    }), '4-even-out.png', 1280, 800);
    await render(screenshotHtml({
      title: 'Private by design',
      sub: 'No ads. No tracking. No data collected.',
      bullets: ['No scary install warnings: access is asked one site at a time', 'Light and dark theme', 'Chrome, Edge and Firefox'],
      img: shotDark, dark: true,
    }), '5-private.png', 1280, 800);
    await render(smallTileHtml(), 'promo-small-440x280.png', 440, 280);
    await render(marqueeHtml(shotRemember), 'promo-marquee-1400x560.png', 1400, 560);
  } finally {
    await ctx.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
