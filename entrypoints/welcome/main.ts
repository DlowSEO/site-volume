import { browser } from 'wxt/browser';
import { CAN_FORCE } from '@/utils/shared';

const $ = (id: string) => document.getElementById(id)!;

// ---------- Pinned? (Chromium only: action.getUserSettings) ----------
type ActionWithSettings = { getUserSettings?: () => Promise<{ isOnToolbar?: boolean }> };
const action = browser.action as unknown as ActionWithSettings;
async function checkPinned() {
  if (!action.getUserSettings) return;
  const { isOnToolbar } = await action.getUserSettings();
  if (isOnToolbar === undefined) return;
  const s = $('pinStatus');
  s.hidden = false;
  s.textContent = isOnToolbar ? '✓ Pinned. You’re all set.' : 'Not pinned yet.';
  s.classList.toggle('ok', isOnToolbar);
}
void checkPinned();
setInterval(() => void checkPinned(), 1000);

// ---------- Shortcuts, as the browser actually has them ----------
const labels: Record<string, string> = {
  'volume-up': 'Volume up 10%',
  'volume-down': 'Volume down 10%',
  'toggle-mute': 'Mute this site',
};
void browser.commands.getAll().then((cmds) => {
  const list = $('shortcuts');
  list.replaceChildren();
  const order = Object.keys(labels);
  const sorted = cmds.filter((c) => c.name && labels[c.name]).sort((a, b) => order.indexOf(a.name!) - order.indexOf(b.name!));
  for (const c of sorted) {
    if (!c.name) continue;
    const li = document.createElement('li');
    if (c.shortcut) {
      const k = document.createElement('kbd');
      k.textContent = c.shortcut;
      li.append(k, ` ${labels[c.name]}`);
    } else li.textContent = `${labels[c.name]}: not set`;
    list.append(li);
  }
});
if (import.meta.env.FIREFOX) {
  $('shortcutHint').textContent = 'Change them in Add-ons → ⚙ → Manage Extension Shortcuts.';
} else if (import.meta.env.EDGE) {
  $('shortcutsUrl').textContent = 'edge://extensions/shortcuts';
}
if (!CAN_FORCE) $('forceTip').hidden = true;
