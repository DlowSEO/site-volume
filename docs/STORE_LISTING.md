# Store listing pack

Everything to paste into the Chrome Web Store, Edge Add-ons and Firefox Add-ons dashboards.
Images are in `store/` (regenerate with `npm run store:assets`). Upload zips come from `npm run zip`, `npm run zip:edge` and `npm run zip:firefox`.

Repo: https://github.com/DlowSEO/site-volume · Privacy policy: https://github.com/DlowSEO/site-volume/blob/main/PRIVACY.md

---

## Name
Site Volume: Remember & Boost Volume Per Site

## Summary (from the manifest, 131 of 132 characters)
Set a volume for each website and it remembers. Boost to 600% with a built-in limiter. Full screen still works. No ads or tracking.

## Category
Chrome: **Tools** (under Productivity) · Edge: **Productivity** · Firefox: **Photos, Music & Videos**

## Description
```
Tired of YouTube blasting while BBC iPlayer whispers? Site Volume gives every website its own volume, and remembers it.

SET IT ONCE, IT REMEMBERS
• Pick a volume for a site, tick Remember, and it applies automatically every time you visit
• Mute a site for good with one click
• Settings sync between your computers through your browser

BOOST QUIET AUDIO, CLEANLY
• Up to 200% out of the box, 600% if you need it (with a warning first)
• Built-in limiter keeps boosted sound from crackling and distorting
• Full screen keeps working. Site Volume doesn't capture your tab to boost it, so there's no "this tab is being shared" banner

EVEN OUT VOLUME
• One tick brings loud ads and quiet speech closer together

CONTROL OTHER TABS
• See every tab playing sound, then adjust, mute or jump to it without switching

FORCE BOOST FOR PROTECTED PLAYERS (optional)
• Netflix, Spotify and other protected players can't normally be boosted by any extension. Turn on Force boost for those sites and Site Volume handles the tab's sound directly

FAST TO USE
• Slider tuned to how loudness sounds, so steps feel even
• Presets, scroll wheel, arrow keys and keyboard shortcuts (Alt+Shift+↑/↓/M, Ctrl+Shift on Mac)
• Current level shown on the toolbar icon
• Light and dark theme

PRIVATE BY DESIGN
• No ads, no tracking, no data collected, no network requests
• No scary install warning: access is asked one site at a time, only when you tick Remember
• Open source: https://github.com/DlowSEO/site-volume

Good to know: without Force boost, protected streams (Netflix, Prime Video, Disney+, Spotify) can be turned down but not boosted. Games that make their own sound with Web Audio aren't controlled yet.
```

## Images
| Store | Field | File |
|---|---|---|
| Chrome | Screenshots (1280×800, up to 5) | `store/1-remember.png` … `store/5-private.png` |
| Chrome | Small promo tile (440×280, required) | `store/promo-small-440x280.png` |
| Chrome | Marquee (1400×560, optional) | `store/promo-marquee-1400x560.png` |
| Chrome / Edge | Store icon (128×128) | `public/icon/128.png` |
| Edge | Screenshots (1280×800) | same as Chrome |
| Edge | Small / large promo tile | `promo-small-440x280.png` / `promo-marquee-1400x560.png` |
| Firefox | Screenshots | same as Chrome |

## Chrome "Privacy practices" tab

**Single purpose**
> Lets the user set, boost and remember the audio volume of each website.

**Permission justifications**
- **storage**: Saves the volume the user sets for each website they choose to remember, plus their preferences.
- **activeTab**: Adjusts the volume of the tab the user is on when they click the extension icon or use a keyboard shortcut, without needing broad host access.
- **scripting**: Injects the audio engine into the current tab (via activeTab) or into sites the user has chosen to remember, so it can adjust that page's audio and video elements.
- **offscreen**: Plays a tab's audio back with the volume boost applied when the user switches on the optional Force boost feature; service workers can't play audio.
- **tabCapture (optional)**: Requested only when the user switches on Force boost for a site whose protected player can't otherwise be boosted. The audio is processed locally and played straight back; it's never recorded or transmitted.
- **Host permissions (optional)**: Requested for one site at a time when the user ticks Remember, so the saved volume applies automatically when they visit that site. The user can optionally grant all sites to control every tab from the popup.

**Remote code**: No, I am not using remote code.

**Data usage**: tick nothing (no data collected). Tick all three certifications.

**Privacy policy URL**: `https://github.com/DlowSEO/site-volume/blob/main/PRIVACY.md`

## Edge notes
- Same zip as Chrome works; `npm run zip:edge` builds an Edge-labelled one.
- The certification notes field can reuse the permission justifications above.
- Testing notes for reviewers: "Open any site playing video (e.g. YouTube), click the icon, move the slider. Force boost: open Netflix or Spotify, play, click the icon, tick Force boost."

## Firefox notes
- Upload `npm run zip:firefox` plus the sources zip WXT creates alongside it (AMO asks for source code because the build is bundled).
- Set the add-on URL slug to `site-volume`, so the rating link in the popup works (`entrypoints/popup/main.ts`, `REVIEW_URL`). If AMO gives a different slug, update it there.
- Force boost isn't available in Firefox; the description's Force boost section can be removed for the AMO listing.

## After launch
- Reply to every early review, positive or not; it shows on the listing.
- Launch posts: see `docs/RESEARCH.md` → Launch channels.
- Translations of the listing: planned for later releases.
