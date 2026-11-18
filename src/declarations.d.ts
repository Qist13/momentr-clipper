/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

// The API that preload.ts exposes to the settings page
interface Window {
  momentr: {
    getSettings: () => Promise<import('./settings').Settings>;
    saveSettings: (
      settings: import('./settings').Settings,
    ) => Promise<import('./settings').Settings>;
    chooseFolder: (current: string) => Promise<string | null>;
  };
}
