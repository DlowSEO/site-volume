import { defineConfig } from 'wxt';

// Permission model: nothing that triggers an install-time warning.
// - activeTab: control the current tab when the user clicks the icon / uses a shortcut
// - optional_host_permissions: requested one site at a time when the user clicks "Remember"
// - optional tabCapture: requested only when the user turns on Force boost
export default defineConfig({
  manifest: ({ browser }) => ({
    name: 'Site Volume: Remember & Boost Volume Per Site',
    short_name: 'Site Volume',
    description:
      'Set a volume for each website and it remembers. Boost up to 600% with a built-in limiter. Full screen still works. No ads, no tracking.',
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
    action: { default_title: 'Site Volume' },
    commands: {
      'volume-up': {
        suggested_key: { default: 'Alt+Shift+Up' },
        description: 'Volume up 10%',
      },
      'volume-down': {
        suggested_key: { default: 'Alt+Shift+Down' },
        description: 'Volume down 10%',
      },
      'toggle-mute': {
        suggested_key: { default: 'Alt+Shift+M' },
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
