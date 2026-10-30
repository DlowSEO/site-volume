import { defineConfig } from 'wxt';

// Permission model: nothing that triggers an install-time warning.
// - activeTab: control the current tab when the user clicks the icon / uses a shortcut
// - optional_host_permissions: requested one site at a time when the user clicks "Remember"
// - optional tabCapture: requested only when the user turns on Force boost
export default defineConfig({
  // Firefox review asks for source code; keep build copies and store images out of that zip.
  zip: { excludeSources: ['Load in Chrome/**', 'store/**', 'Claude outputs/**', '.output/**'] },
  manifest: ({ browser, mode }) => ({
    name: 'Site Volume: Remember & Boost Volume Per Site',
    short_name: 'Site Volume',
    description:
      // Chrome Web Store limit: 132 characters.
      'Set a volume for each website and it remembers. Boost to 600% with a built-in limiter. Full screen still works. No ads or tracking.',
    permissions: [
      'storage',
      'activeTab',
      'scripting',
      // Force boost plays captured audio from an offscreen document — Chromium only
      ...(browser === 'firefox' ? [] : ['offscreen']),
    ],
    // tabCapture is only requested when the user switches on Force boost, so install stays warning-free.
    ...(browser === 'firefox' ? {} : { optional_permissions: ['tabCapture'] }),
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    // Automated tests only (npm run test:e2e): pre-grant the local test server so no prompt is needed.
    ...(mode === 'e2e' ? { host_permissions: ['*://localhost/*', '*://www.localhost/*', '*://127.0.0.1/*'] } : {}),
    action: { default_title: 'Site Volume' },
    commands: {
      'volume-up': {
        // On a Mac, Option+Shift+↑/↓ selects text, so use Control there.
        suggested_key: { default: 'Alt+Shift+Up', mac: 'MacCtrl+Shift+Up' },
        description: 'Volume up 10%',
      },
      'volume-down': {
        suggested_key: { default: 'Alt+Shift+Down', mac: 'MacCtrl+Shift+Down' },
        description: 'Volume down 10%',
      },
      'toggle-mute': {
        suggested_key: { default: 'Alt+Shift+M', mac: 'MacCtrl+Shift+M' },
        description: 'Mute / unmute this site',
      },
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'site-volume@adrankone.com',
              strict_min_version: '128.0',
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
  }),
});
