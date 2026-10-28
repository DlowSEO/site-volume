# Site Volume

**Remember and boost volume per website. Full screen still works. No ads, no tracking.**

Set BBC iPlayer to 70% and YouTube to 150% once — it remembers every visit.

## Features (v0.2)
- Volume 0–200% per site (unlock up to 600% with a hearing/speaker warning)
- Remembered per site, applied automatically when you visit
- Built-in limiter on by default to stop boosted audio distorting
- Perceptual slider (even steps), mouse-wheel control (Shift = 10% steps), presets
- Mute any site / "always mute this site"
- **Even out volume** per site — compressor that brings loud ads and quiet speech closer together
- **Force boost** per site (Chrome/Edge, opt-in) — captures the tab so boost works on *any* site, including Netflix/Spotify. Off by default because tab capture can affect full screen
- Level shown on the toolbar icon
- Other tabs playing sound: jump to, mute, or adjust — without switching tabs (optional "Allow on all sites" to control every tab)
- Shortcuts: Alt+Shift+↑ / ↓ (±10%), Alt+Shift+M (mute) — change at chrome://extensions/shortcuts
- Light/dark theme follows your system

## Privacy & permissions
- **No install-time warnings.** Uses `activeTab` (works on the tab you click the icon on) and asks for access to a site only when you tick **Remember** for that site.
- Optional extras, each asked for only when you use the feature: `tabCapture` (Force boost) and all-sites access (control every tab from the popup).
- No analytics, no network requests, no remote code. Settings sync via your Chrome account (`chrome.storage.sync`).

## How it works
Other volume extensions capture the whole tab (`chrome.tabCapture`), which is what breaks full screen and shows "this tab's content is being shared". Site Volume instead routes each `<video>`/`<audio>` element on the page through Web Audio: element → gain → limiter → speakers.

Safety rules so it never makes a page silent:
- DRM-protected streams (Netflix, Prime Video, Disney+…) and cross-site audio without CORS can't go through Web Audio, so they fall back to normal volume control (max 100%) and the popup says so.
- Chrome won't start audio processing until you've interacted with the page; until then the popup asks you to click the page once.
- At 100% and unmuted the page is left completely untouched.

## Known limitations (v0.2)
- Without Force boost, boost above 100% isn't possible on DRM streaming sites (lowering volume works).
- Force boost starts when you open the popup or use a shortcut on that tab (Chrome requires that click); it isn't available in Firefox.
- Video embedded from another site (e.g. a YouTube embed on a blog) is only controlled if that site is also remembered.
- Sound made directly with Web Audio by the page (some games, web synths) isn't controlled yet.

## Load it in Firefox (temporary)
`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick `.output/firefox-mv3/manifest.json`

## Load it in Chrome (unpacked)
1. `chrome://extensions` → turn on **Developer mode**
2. **Load unpacked** → select `.output/chrome-mv3`
3. Pin it from the puzzle-piece menu

## Development
> `node_modules` was installed from a Linux VM. On your Mac run `rm -rf node_modules && npm install` once first.

```bash
npm run dev          # Chrome with hot reload
npm run build        # production build → .output/chrome-mv3
npm run build:edge   # Edge build
npm run build:firefox # Firefox (MV3) build → .output/firefox-mv3
npm run build:all    # Chrome + Edge + Firefox
npm run zip          # store-ready zip
npm run compile      # type-check
```
Built with [WXT](https://wxt.dev) + TypeScript, no UI framework (popup JS ≈ 6 kB).
