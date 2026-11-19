import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const linuxAutostartFile = () =>
  path.join(
    app.getPath('home'),
    '.config',
    'autostart',
    'momentr-clipper.desktop',
  );

const launchCommand = () => {
  if (!app.isPackaged) return `"${process.execPath}" "${app.getAppPath()}"`;
  return `"${process.env.APPIMAGE ?? process.execPath}"`;
};

const setLinuxAutoStart = (enabled: boolean) => {
  const file = linuxAutostartFile();
  if (!enabled) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Momentr Clipper',
    `Exec=${launchCommand()}`,
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
  fs.writeFileSync(file, entry);
};

const setWindowsAutoStart = (enabled: boolean) => {
  if (!app.isPackaged) return;
  const updateExe = path.resolve(
    path.dirname(process.execPath),
    '..',
    'Update.exe',
  );
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: updateExe,
    args: ['--processStart', path.basename(process.execPath)],
  });
};

export const setAutoStart = (enabled: boolean): string | null => {
  try {
    if (process.platform === 'linux') setLinuxAutoStart(enabled);
    else if (process.platform === 'win32') setWindowsAutoStart(enabled);
    else app.setLoginItemSettings({ openAtLogin: enabled });
    return null;
  } catch (err) {
    console.error("Couldn't change start at login:", err);
    return "Couldn't change start at login";
  }
};
