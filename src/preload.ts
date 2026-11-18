// Runs before the settings page loads. It has access to Electron's
// ipcRenderer and exposes a small, safe API to the page as window.momentr.
import { contextBridge, ipcRenderer } from 'electron';
import type { Settings } from './settings';

contextBridge.exposeInMainWorld('momentr', {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (
    settings: Settings,
  ): Promise<{ settings: Settings; error: string | null }> =>
    ipcRenderer.invoke('settings:save', settings),
  chooseFolder: (current: string): Promise<string | null> =>
    ipcRenderer.invoke('settings:chooseFolder', current),
});
