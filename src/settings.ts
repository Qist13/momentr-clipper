import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export type Settings = {
    clipSeconds: number;
    hotkey: string;
    fps: number;
    clipsDir: string;
};

// Choices offered in the settings window.
// Clip lengths must be even: the buffer is made of 2-second segments.
export const CLIP_SECONDS_OPTIONS = [10, 20, 30, 60, 90, 120];
export const FPS_OPTIONS = [30, 60, 144];

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
    const clipSeconds = CLIP_SECONDS_OPTIONS.includes(Number(input.clipSeconds))
        ? Number(input.clipSeconds)
        : current.clipSeconds;

    const fps = FPS_OPTIONS.includes(Number(input.fps))
        ? Number(input.fps)
        : current.fps;

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
