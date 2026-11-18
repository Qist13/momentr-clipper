import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export type Settings = {
    clipSeconds: number;
    hotkey: string;
    fps: number;
    clipsDir: string;
};

const settingsPath = path.join(app.getPath("userData"), "settings.json");

const defaults = (): Settings => ({
    clipSeconds: 30,
    hotkey: "F8",
    fps: 30,
    clipsDir: path.join(app.getPath("videos"), "Momentr"),
});

export const loadSettings = (): Settings => {
    try {
        const saved = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        return { ...defaults(), ...saved };
    } catch {
        return defaults();
    }
};

export const saveSettings = (settings: Settings) => {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
};

// Settings coming from the window can't be trusted: fix up anything invalid
// and fall back to the current value for missing fields
export const cleanSettings = (input: Partial<Settings>, current: Settings): Settings => {
    const seconds = Number(input.clipSeconds);
    const clipSeconds = Number.isFinite(seconds)
        ? // Clamp to 10-120 and round up to even (segments are 2 seconds)
          Math.ceil(Math.min(120, Math.max(10, seconds)) / 2) * 2
        : current.clipSeconds;

    const fps = Number(input.fps) === 60 ? 60 : 30;

    const hotkey =
        typeof input.hotkey === "string" && input.hotkey.trim()
            ? input.hotkey.trim()
            : current.hotkey;

    const clipsDir =
        typeof input.clipsDir === "string" && input.clipsDir.trim()
            ? input.clipsDir.trim()
            : current.clipsDir;

    return { clipSeconds, fps, hotkey, clipsDir };
};
