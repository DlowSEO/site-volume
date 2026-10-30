/**
 * End-to-end test: loads the e2e build into Chromium, plays a test tone and measures what the
 * extension actually outputs.
 *
 *   npm run test:e2e            (builds with --mode e2e first)
 *   One-off setup:  npx playwright install chromium
 *
 * The e2e build differs from the real one in two ways only: localhost is pre-granted (no
 * permission prompt) and the audio output level is published on <html data-sv-rms>.
 */
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const EXT = path.resolve(__dirname, '../.output/chrome-mv3-e2e');
const PORT = 8765;
const AMP = 0.1; // test tone amplitude → RMS 0.0707 at 100%
const BASE_RMS = AMP / Math.SQRT2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Test pages ----------
function toneWav(seconds = 10, rate = 44100) {
  const n = seconds * rate;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(AMP * 32767 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
  return b;
}
const pages = {
  '/tone.wav': ['audio/wav', toneWav()],
  // Plain same-origin <audio>
  '/': ['text/html', `<!doctype html><button id=b onclick="a.play()">play</button><audio id=a src="/tone.wav" loop></audio>`],
  // <audio> inside a web component's shadow root
  '/shadow': ['text/html', `<!doctype html><my-player></my-player><button id=b>play</button><script>
    customElements.define('my-player', class extends HTMLElement { constructor() { super();
      this.attachShadow({ mode: 'open' }).innerHTML = '<audio src="/tone.wav" loop></audio>'; } });
    b.onclick = () => document.querySelector('my-player').shadowRoot.querySelector('audio').play();</script>`],
  // new Audio().play() that never joins the page
  '/detached': ['text/html', `<!doctype html><button id=b onclick="window.a = new Audio('/tone.wav'); a.loop = true; a.play()">play</button>`],
  // Cross-origin audio without CORS → can only be controlled up to 100%
  '/xorigin': ['text/html', `<!doctype html><button id=b onclick="a.play()">play</button>
    <button id=v onclick="a.volume=0.8">page sets 80%</button>
    <audio id=a src="http://127.0.0.1:${PORT}/tone.wav" loop></audio>`],
};
const server = http.createServer((req, res) => {
  const p = pages[req.url.split('?')[0]];
  if (!p) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': p[0] }).end(p[1]);
});

// ---------- Tiny assertion helper ----------
let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
}
const near = (a, b, tol = 0.03) => Math.abs(a - b) <= b * tol + 1e-4;

(async () => {
  if (!fs.existsSync(path.join(EXT, 'manifest.json'))) throw new Error(`Build first: ${EXT} missing`);
  await new Promise((r) => server.listen(PORT, r));
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'sv-')), {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
    const extId = sw.url().split('/')[2];
    await sleep(800); // let the background register the content script
    const welcome = ctx.pages().find((p) => p.url().endsWith('/welcome.html'));
    check('welcome page opens on first install', !!welcome);
    if (welcome && process.env.SHOTS) await welcome.screenshot({ path: path.join(process.env.SHOTS, 'welcome.png'), fullPage: true });

    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'http://localhost/*' }))[0].id);
    const open = async (url) => { await page.goto(`http://localhost:${PORT}${url}`); await page.click('#b'); await sleep(1200); };
    // Median of several readings, so a read that lands on the loop point of the tone doesn't count.
    const rms = async () => {
      await sleep(600);
      const xs = [];
      for (let i = 0; i < 5; i++) {
        xs.push(Number(await page.evaluate(() => document.documentElement.dataset.svRms ?? 'NaN')));
        await sleep(110);
      }
      return xs.sort((a, b) => a - b)[2];
    };

    // The popup, opened as a tab but told the test page is the "active tab".
    const popup = await ctx.newPage();
    await popup.addInitScript((tid) => {
      const q = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = async (o) => (o && o.active ? [await chrome.tabs.get(tid)] : q(o));
    }, tabId);
    const errors = [];
    popup.on('pageerror', (e) => errors.push(e.message));
    const openPopup = async () => { await popup.goto(`chrome-extension://${extId}/popup.html`); await sleep(700); };
    const setPos = (pos) => popup.evaluate((p) => { const s = document.getElementById('slider'); s.value = p; s.dispatchEvent(new Event('input')); }, pos);
    const shown = () => popup.evaluate(() => document.getElementById('value').textContent);
    const notice = () => popup.evaluate(() => document.getElementById('notice').hidden ? '' : document.getElementById('noticeText').textContent);
    const syncData = () => sw.evaluate(() => chrome.storage.sync.get(null));
    const posFor = (g, max = 2) => (g <= 1 ? Math.pow(g, 1 / 1.6) * 600 : 600 + ((g - 1) / (max - 1)) * 400);

    // --- Basic levels ---
    await open('/');
    check('untouched at 100%', Number.isNaN(await rms()));
    await openPopup();
    for (const g of [2, 1.5, 0.5]) {
      await setPos(Math.round(posFor(g)));
      const r = await rms();
      check(`output at ${g * 100}%`, near(r, BASE_RMS * g), `rms ${r.toFixed(4)}, want ${(BASE_RMS * g).toFixed(4)}`);
    }
    await setPos(600);
    let r = await rms();
    check('back to 100% is exact (no limiter colouring)', near(r, BASE_RMS), r.toFixed(4));
    await popup.click('#mute');
    check('mute is silent', (await rms()) < 1e-4);
    await popup.click('#mute');

    // --- Keyboard ---
    await popup.focus('#slider');
    for (let i = 0; i < 5; i++) await popup.keyboard.press('ArrowUp');
    await sleep(300);
    check('arrow keys move 2% per press', (await shown()) === '110%', await shown());
    await popup.keyboard.press('Shift+ArrowDown');
    await sleep(300);
    check('Shift+arrow moves 10%', (await shown()) === '100%', await shown());

    // --- Wheel / trackpad ---
    await popup.evaluate(() => { for (let i = 0; i < 40; i++) document.body.dispatchEvent(new WheelEvent('wheel', { deltaY: -4, bubbles: true, cancelable: true })); });
    await sleep(300);
    check('trackpad swipe moves a few steps, not 40', (await shown()) === '106%', await shown());
    await popup.evaluate(() => document.body.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })));
    await sleep(300);
    check('one mouse-wheel notch = 2%', (await shown()) === '104%', await shown());

    // --- Remember + storage quota ---
    await popup.click('#remember');
    await sleep(500);
    check('Remember ticks without a prompt when already allowed', await popup.isChecked('#remember'));
    for (let i = 0; i < 300; i++) { await setPos(600 + (i % 400)); await sleep(15); }
    await setPos(1000);
    await sleep(1500);
    r = await rms();
    check('slider still works after fast dragging with Remember on', near(r, BASE_RMS * 2), r.toFixed(4));
    check('saved level is the last one set', (await syncData())['site:localhost']?.v === 2, JSON.stringify(await syncData()));
    await page.reload(); await page.click('#b'); await sleep(1200);
    r = await rms();
    check('remembered level applies after reload', near(r, BASE_RMS * 2), r.toFixed(4));
    await popup.click('#remember');
    await sleep(1500);
    check('unticking Remember deletes the saved level', !(await syncData())['site:localhost'], JSON.stringify(await syncData()));

    // --- Per-tab level doesn't follow the tab to another site ---
    await page.goto(`http://127.0.0.1:${PORT}/`); await page.click('#b'); await sleep(1200);
    check('level set on one site not applied to the next site', Number.isNaN(await rms()));
    const st = await popup.evaluate((t) => chrome.runtime.sendMessage({ type: 'popup:state', tabId: t }), tabId);
    check('next site starts at 100%', st?.level?.v === 1, JSON.stringify(st?.level));

    // --- Shadow DOM ---
    await open('/shadow');
    await openPopup();
    await setPos(Math.round(posFor(1.5)));
    r = await rms();
    check('audio inside a shadow root is boosted', near(r, BASE_RMS * 1.5), `rms ${r.toFixed(4)}`);

    // --- new Audio() never added to the page ---
    await open('/detached');
    await openPopup();
    await setPos(Math.round(posFor(1.5)));
    r = await rms();
    check('detached new Audio() is boosted', near(r, BASE_RMS * 1.5), `rms ${r.toFixed(4)}`);

    // --- Cross-origin fallback ---
    await open('/xorigin');
    await openPopup();
    await setPos(Math.round(posFor(0.5)));
    await sleep(500);
    const vol = () => page.evaluate(() => document.getElementById('a').volume);
    check('cross-origin audio lowered via element volume', near(await vol(), 0.5), String(await vol()));
    await page.click('#v');
    await sleep(300);
    check("page's own volume change is respected (80% × 50%)", near(await vol(), 0.4), String(await vol()));
    await setPos(1000);
    await sleep(1200);
    check('boost on cross-origin audio explains itself', /can't be boosted/.test(await notice()), await notice());

    // --- Review prompt stays hidden for new users ---
    check('no review prompt on first use', await popup.evaluate(() => document.getElementById('review').hidden));

    check('no errors in the popup', errors.length === 0, errors.join(' | '));
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
