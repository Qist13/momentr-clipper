import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export type Settings = {
    clipSeconds: number;
    hotkey: string;
    recordHotkey: string;
    fps: number;
    clipsDir: string;
    openAtLogin: boolean;
    recordMic: boolean;
};

// Choices offered in the settings window.
// Clip lengths must be even: the buffer is made of 2-second segments.
export const CLIP_SECONDS_OPTIONS = [10, 20, 30, 60, 90, 120];
export const FPS_OPTIONS = [30, 60, 144];

const settingsPath = path.join(app.getPath("userData"), "settings.json");

const defaults = (): Settings => ({
    clipSeconds: 30,
    hotkey: "F8",
    recordHotkey: "F9",
    fps: 30,
    clipsDir: path.join(app.getPath("videos"), "Momentr"),
    openAtLogin: false,
    recordMic: false,
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

    const text = (value: unknown, fallback: string) =>
        typeof value === "string" && value.trim() ? value.trim() : fallback;

    const hotkey = text(input.hotkey, current.hotkey);
    const recordHotkey = text(input.recordHotkey, current.recordHotkey);

    const clipsDir = text(input.clipsDir, current.clipsDir);

    const openAtLogin =
        typeof input.openAtLogin === "boolean"
            ? input.openAtLogin
            : current.openAtLogin;

    const recordMic =
        typeof input.recordMic === "boolean" ? input.recordMic : current.recordMic;

    return {
        clipSeconds,
        fps,
        hotkey,
        recordHotkey,
        clipsDir,
        openAtLogin,
        recordMic,
    };
};
