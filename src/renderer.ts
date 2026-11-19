// Runs in the settings window (renderer process). No Node.js access here;
// it talks to the main process through window.momentr (see preload.ts).
import './index.css';
import type { Settings } from './settings';
import { keyName, modifiers, worksAlone } from './hotkey';

const form = document.getElementById('settings-form') as HTMLFormElement;
const status = document.getElementById('status') as HTMLSpanElement;
const browse = document.getElementById('browse') as HTMLButtonElement;

const field = (id: string) =>
  document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
const checkbox = (id: string) => document.getElementById(id) as HTMLInputElement;

// Put saved settings into the form
const fill = (settings: Settings) => {
  field('clipSeconds').value = String(settings.clipSeconds);
  field('fps').value = String(settings.fps);
  field('hotkey').value = settings.hotkey;
  field('recordHotkey').value = settings.recordHotkey;
  field('clipsDir').value = settings.clipsDir;
  checkbox('openAtLogin').checked = settings.openAtLogin;
};

window.momentr.getSettings().then(fill);

const showStatus = (text: string, isError = false) => {
  status.textContent = text;
  status.classList.toggle('error', isError);
};

// --- Hotkey capture: click a hotkey field, then press the key combination ---

const setupHotkeyField = (input: HTMLInputElement) => {
  let capturing = false;
  let previous = '';

  const startCapture = () => {
    if (capturing) return;
    capturing = true;
    previous = input.value;
    input.value = '';
    input.placeholder = 'Press a key… (Esc to cancel)';
    input.classList.add('capturing');
    showStatus('');
    // Otherwise pressing a current hotkey would trigger it instead
    window.momentr.pauseHotkey(true);
  };

  // With no value, restores the hotkey from before capture started
  const stopCapture = (value?: string) => {
    if (!capturing) return;
    capturing = false;
    input.value = value ?? previous;
    input.placeholder = '';
    input.classList.remove('capturing');
    window.momentr.pauseHotkey(false);
  };

  input.addEventListener('focus', startCapture);
  input.addEventListener('blur', () => stopCapture());

  input.addEventListener('keydown', (event) => {
    const mods = modifiers(event);

    // Plain Tab still moves to the next field
    if (event.key === 'Tab' && mods.length === 0) return;
    event.preventDefault();

    if (event.key === 'Escape') {
      input.blur();
      return;
    }

    const key = keyName(event.code);

    // Only modifiers held so far: show them and keep waiting
    if (!key) {
      input.value = mods.length ? mods.join('+') + '+…' : '';
      return;
    }

    if (mods.length === 0 && !worksAlone(key)) {
      showStatus(`Add Ctrl, Alt or Shift to use ${key}`, true);
      input.value = '';
      return;
    }

    stopCapture([...mods, key].join('+'));
    input.blur();
    showStatus('Click Save to apply');
  });
};

document
  .querySelectorAll<HTMLInputElement>('input.hotkey')
  .forEach(setupHotkeyField);

browse.addEventListener('click', async () => {
  const folder = await window.momentr.chooseFolder(field('clipsDir').value);
  if (folder) field('clipsDir').value = folder;
});

form.addEventListener('submit', async (event) => {
  // Stop the browser from reloading the page on submit
  event.preventDefault();

  const { settings, error } = await window.momentr.saveSettings({
    clipSeconds: Number(field('clipSeconds').value),
    fps: Number(field('fps').value),
    hotkey: field('hotkey').value,
    recordHotkey: field('recordHotkey').value,
    clipsDir: field('clipsDir').value,
    openAtLogin: checkbox('openAtLogin').checked,
  });

  // On success show what main is using (it may have corrected values).
  // On error keep the user's edits so they can fix the hotkey.
  if (!error) fill(settings);
  showStatus(error ?? 'Saved', error !== null);
});
