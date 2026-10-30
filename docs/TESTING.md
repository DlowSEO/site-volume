# Manual test checklist

Automated: `npm run test:e2e` covers volume accuracy, mute, keyboard/wheel/trackpad, Remember (incl. rapid dragging), reload, per-site isolation, shadow DOM and cross-origin fallback. The list below is what still needs a human: real sites, full screen, permission prompts, Force boost, Firefox/Edge.

Load `.output/chrome-mv3` unpacked, pin the icon. For each site: play something, open the popup.

| # | Site | Set 150% | Louder? | Full screen OK? | Tick Remember → reload → still 150%? | Popup message correct? | Notes |
|---|------|----------|---------|-----------------|------------------------------------|------------------------|-------|
| 1 | YouTube | | | | | | |
| 2 | YouTube Music | | | | | | |
| 3 | Twitch | | | | | | |
| 4 | BBC iPlayer | | | | | | |
| 5 | BBC Sounds | | | | | | |
| 6 | Spotify Web | | | | | | expect DRM → 100% max message |
| 7 | Netflix / Prime | | | | | | expect DRM → 100% max message, lowering works |
| 8 | SoundCloud | | | | | | |
| 9 | Bandcamp | | | | | | |
| 10 | X / Facebook video | | | | | | |
| 11 | Blog with YouTube embed | | | | | | |

## Behaviour checks
- [ ] Install shows **no** permission warning
- [ ] Ticking Remember shows a one-site permission prompt; afterwards the setting survives reload and browser restart
- [ ] Unticking Remember removes the saved level and the site permission
- [ ] Boosted audio isn't distorted at 200% (limiter); turn limiter off later to compare
- [ ] 600% unlock shows the warning first
- [ ] Mouse wheel in popup changes volume; Shift = 10% steps
- [ ] Shortcuts Alt+Shift+↑/↓/M (Mac: Ctrl+Shift+↑/↓/M) work without opening the popup
- [ ] Badge shows level / M, blank at 100%
- [ ] "Other tabs playing sound" lists background tabs; mute and go-to-tab work
- [ ] Headphones / Bluetooth switch mid-playback keeps sound
- [ ] Back to 100% → page behaves exactly as without the extension
- [ ] Dark mode popup looks right
- [ ] chrome://extensions → no errors on the extension card

## v0.2 checks
- [ ] **Even out volume**: on a YouTube video with quiet speech + loud music/ads, tick it — loud bits quieter, quiet bits louder; badge shows ≈ at 100%
- [ ] **Force boost** on Netflix/Spotify: popup shows "can't be boosted" + **Use Force boost** → Chrome asks once for the capture permission → audio gets louder above 100%
- [ ] Force boost: note what full screen does (expect browser bars may show) and whether Chrome shows a sharing/recording icon
- [ ] Force boost off → normal audio straight away, no silence
- [ ] Force boost + Remember: close and reopen the site → opening the popup restarts the boost
- [ ] **Other tabs**: with two sites playing, adjust the background tab's slider without switching
- [ ] A tab without access shows **Allow** → "Allow on all sites" prompt → its slider appears
- [ ] Firefox: load `.output/firefox-mv3` temporarily; per-site volume, Remember, Even out work; no Force boost option shown
- [ ] Edge: load `.output/edge-mv3` unpacked; same as Chrome
