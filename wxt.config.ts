import { defineConfig } from 'wxt';

// Permission model: nothing that triggers an install-time warning.
// - activeTab: control the current tab when the user clicks the icon / uses a shortcut
// - optional_host_permissions: requested one site at a time when the user clicks "Remember"
export default defineConfig({
  manifest: {
    name: 'Site Volume: Remember & Boost Volume Per Site',
    short_name: 'Site Volume',
    description:
      'Set a volume for each website and it remembers. Boost up to 600% with a built-in limiter. Full screen still works. No ads, no tracking.',
    permissions: ['storage', 'activeTab', 'scripting'],
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
  },
});
