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
