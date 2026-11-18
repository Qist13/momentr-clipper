// Runs in the settings window (renderer process). No Node.js access here;
// it talks to the main process through window.momentr (see preload.ts).
import './index.css';
import type { Settings } from './settings';

const form = document.getElementById('settings-form') as HTMLFormElement;
const status = document.getElementById('status') as HTMLSpanElement;
const browse = document.getElementById('browse') as HTMLButtonElement;

const field = (id: string) =>
  document.getElementById(id) as HTMLInputElement | HTMLSelectElement;

// Put saved settings into the form
const fill = (settings: Settings) => {
  field('clipSeconds').value = String(settings.clipSeconds);
  field('fps').value = String(settings.fps);
  field('hotkey').value = settings.hotkey;
  field('clipsDir').value = settings.clipsDir;
};

window.momentr.getSettings().then(fill);

browse.addEventListener('click', async () => {
  const folder = await window.momentr.chooseFolder(field('clipsDir').value);
  if (folder) field('clipsDir').value = folder;
});

form.addEventListener('submit', async (event) => {
  // Stop the browser from reloading the page on submit
  event.preventDefault();

  const saved = await window.momentr.saveSettings({
    clipSeconds: Number(field('clipSeconds').value),
    fps: Number(field('fps').value),
    hotkey: field('hotkey').value,
    clipsDir: field('clipsDir').value,
  });

  // Show what main actually stored (it may have corrected values)
  fill(saved);
  status.textContent = 'Saved. Restart to apply.';
});
