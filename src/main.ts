import {
    app,
    BrowserWindow,
    dialog,
    globalShortcut,
    ipcMain,
    Menu,
    Notification,
    nativeImage,
    shell,
    Tray,
} from "electron";
import { spawn, ChildProcess } from "node:child_process";
import {
    cleanSettings,
    loadSettings,
    saveSettings,
    type Settings,
} from "./settings";
import {
    concatSegments,
    concatSegmentsSync,
    listSegments,
    timestamp,
} from "./segments";
import fs from "node:fs";
import path from "node:path";
import started from "electron-squirrel-startup";

const SEGMENT_SECONDS = 2;

// Store segments in the app's own data folder, not the project folder
const bufferDir = path.join(app.getPath("userData"), "buffer");
// Segments of a start/stop recording are copied here as they finish
const recordingDir = path.join(app.getPath("userData"), "recording");

let ffmpeg: ChildProcess | null = null;
let tray: Tray | null = null;
let settings = loadSettings();
let settingsWindow: BrowserWindow | null = null;
let bufferRestarting = false;
let quitting = false;

// State of a start/stop recording, or null when not recording
let recording: {
    timer: NodeJS.Timeout;
    lastCopied: number; // mtime of the newest buffer segment already copied
    parts: number; // how many segments have been copied
    stopping: boolean;
} | null = null;

const startBuffer = () => {
    const bufferSegments = settings.clipSeconds / SEGMENT_SECONDS + 5;

    // Remove old segments from the last run, then create the folder fresh
    fs.rmSync(bufferDir, { recursive: true, force: true });
    fs.mkdirSync(bufferDir, { recursive: true });

    // Screen capture input differs per OS
    const input =
        process.platform === "win32"
            ? // Whole desktop via GDI; even dimensions are required by libx264
              [
                  "-f",
                  "gdigrab",
                  "-framerate",
                  String(settings.fps),
                  "-i",
                  "desktop",
                  "-vf",
                  "scale=trunc(iw/2)*2:trunc(ih/2)*2",
              ]
            : [
                  "-f",
                  "x11grab",
                  "-framerate",
                  String(settings.fps),
                  "-video_size",
                  "1920x1080",
                  "-i",
                  process.env.DISPLAY ?? ":0",
              ];

    const args = [
        "-loglevel",
        "warning",
        "-nostats",
        ...input,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-g",
        String(settings.fps * SEGMENT_SECONDS),
        "-sc_threshold",
        "0",
        "-f",
        "segment",
        "-segment_time",
        String(SEGMENT_SECONDS),
        "-segment_wrap",
        String(bufferSegments),
        "-reset_timestamps",
        "1",
        path.join(bufferDir, "seg_%03d.ts"),
    ];

    ffmpeg = spawn("ffmpeg", args);
    console.log("Buffer started:", bufferDir);

    ffmpeg.stderr?.on("data", (data) =>
        console.error("[ffmpeg]", data.toString()),
    );
    ffmpeg.on("exit", (code) => {
        console.log("ffmpeg exited with code", code);
        ffmpeg = null;
    });
};

// Stop ffmpeg, wait for it to exit, then start again with the current settings.
// This clears the replay buffer.
const restartBuffer = () => {
    // A restart is already on its way and will pick up the latest settings
    if (bufferRestarting) return;

    if (!ffmpeg) {
        startBuffer();
        return;
    }

    bufferRestarting = true;
    ffmpeg.once("exit", () => {
        bufferRestarting = false;
        if (!quitting) startBuffer();
    });
    ffmpeg.kill("SIGINT");
};

const notifySaved = (title: string, outPath: string) => {
    console.log(`${title}:`, outPath);
    const notification = new Notification({
        title,
        body: path.basename(outPath),
    });
    notification.on("click", () => shell.openPath(outPath));
    notification.show();
};

const notify = (title: string, body = "") =>
    new Notification({ title, body }).show();

const saveClip = async () => {
    // Leave out the newest (still being written), then take the last N
    const finished = listSegments(bufferDir).slice(0, -1);
    const wanted = finished
        .slice(-(settings.clipSeconds / SEGMENT_SECONDS))
        .map((s) => s.name);

    if (wanted.length === 0) {
        console.log("!!! Nothing recorded yet !!!");
        return;
    }

    const outPath = path.join(settings.clipsDir, `clip_${timestamp()}.mp4`);
    if (await concatSegments(bufferDir, wanted, outPath)) {
        notifySaved("Clip saved", outPath);
    } else {
        console.error("Clip failed:", outPath);
    }
};

// --- Start/stop recording ---
// Uses the same ffmpeg as the replay buffer: while recording, every finished
// buffer segment is copied to recordingDir before the buffer wraps around and
// overwrites it. On stop, the copies are joined into one mp4.

const copyNewSegments = (includeNewest = false) => {
    if (!recording) return;
    const segments = listSegments(bufferDir);
    const ready = includeNewest ? segments : segments.slice(0, -1);

    for (const segment of ready) {
        if (segment.time <= recording.lastCopied) continue;
        recording.parts += 1;
        const partName = `part_${String(recording.parts).padStart(5, "0")}.ts`;
        fs.copyFileSync(
            path.join(bufferDir, segment.name),
            path.join(recordingDir, partName),
        );
        recording.lastCopied = segment.time;
    }
};

const partNames = () =>
    fs
        .readdirSync(recordingDir)
        .filter((name) => name.startsWith("part_"))
        .sort();

const startRecording = () => {
    if (!ffmpeg || bufferRestarting) {
        notify("Can't record", "The screen recorder isn't running");
        return;
    }

    fs.rmSync(recordingDir, { recursive: true, force: true });
    fs.mkdirSync(recordingDir, { recursive: true });

    // Start from the segment being written right now (up to 2s before the press)
    const finished = listSegments(bufferDir).slice(0, -1);
    recording = {
        timer: setInterval(() => copyNewSegments(), 1000),
        lastCopied: finished.at(-1)?.time ?? 0,
        parts: 0,
        stopping: false,
    };

    updateTray();
    notify("Recording started", `Press ${settings.recordHotkey} to stop`);
};

const stopRecording = async () => {
    if (!recording || recording.stopping) return;
    recording.stopping = true;
    updateTray();

    // Wait for the segment being written to finish so the last seconds are kept
    await new Promise((r) => setTimeout(r, SEGMENT_SECONDS * 1000 + 500));
    // The app may have quit while waiting (finishRecordingNow saved it)
    if (!recording) return;
    clearInterval(recording.timer);
    copyNewSegments();
    recording = null;
    updateTray();

    const names = partNames();
    if (names.length === 0) {
        notify("Recording failed", "Nothing was recorded");
        return;
    }

    const outPath = path.join(
        settings.clipsDir,
        `recording_${timestamp()}.mp4`,
    );
    if (await concatSegments(recordingDir, names, outPath)) {
        notifySaved("Recording saved", outPath);
        fs.rmSync(recordingDir, { recursive: true, force: true });
    } else {
        // Keep the parts so nothing is lost
        notify("Recording failed", `Segments kept in ${recordingDir}`);
    }
};

const toggleRecording = () => {
    if (recording) stopRecording();
    else startRecording();
};

// Called while quitting: save whatever was recorded, synchronously
const finishRecordingNow = () => {
    if (!recording) return;
    clearInterval(recording.timer);
    copyNewSegments(true);
    recording = null;

    const names = partNames();
    if (names.length === 0) return;
    const outPath = path.join(
        settings.clipsDir,
        `recording_${timestamp()}.mp4`,
    );
    if (concatSegmentsSync(recordingDir, names, outPath)) {
        fs.rmSync(recordingDir, { recursive: true, force: true });
    }
};

const createTray = () => {
    tray = new Tray(appIcon());
    updateTray();
};

const appIcon = () =>
    nativeImage.createFromPath(
        path.join(app.getAppPath(), "assets", "momentr.png"),
    );
// Red dot shown in the tray while a start/stop recording is running
const recordingIcon = () =>
    nativeImage.createFromPath(path.join(app.getAppPath(), "assets", "tray.png"));

// Refresh the tray menu, icon and tooltip after settings or recording change
const updateTray = () => {
    if (!tray) return;
    tray.setContextMenu(buildTrayMenu());
    tray.setImage(recording ? recordingIcon() : appIcon());
    tray.setToolTip(
        recording ? "Momentr Clipper: recording" : "Momentr Clipper (replay on)",
    );
};

const buildTrayMenu = () =>
    Menu.buildFromTemplate([
        { label: `Save clip (${settings.hotkey})`, click: saveClip },
        recording?.stopping
            ? { label: "Saving recording...", enabled: false }
            : {
                  label: `${recording ? "Stop" : "Start"} recording (${settings.recordHotkey})`,
                  click: toggleRecording,
              },
        {
            label: "Open clips folder",
            click: () => shell.openPath(settings.clipsDir),
        },
        { label: "Settings...", click: openSettings },
        { type: "separator" },
        { label: "Quit", click: () => app.quit() },
    ]);

// Register a global hotkey. Returns false if it's invalid or already taken.
const registerHotkey = (hotkey: string, action: () => void) => {
    try {
        return globalShortcut.register(hotkey, action);
    } catch {
        // Electron throws on strings it can't parse, e.g. "Ctrl+"
        return false;
    }
};

// Register every hotkey in these settings that isn't registered yet.
// Returns the first one that failed, or null.
const registerHotkeys = (s: Settings): string | null => {
    const actions: [string, () => void][] = [
        [s.hotkey, saveClip],
        [s.recordHotkey, toggleRecording],
    ];
    let failed: string | null = null;
    for (const [hotkey, action] of actions) {
        if (globalShortcut.isRegistered(hotkey)) continue;
        if (!registerHotkey(hotkey, action)) failed ??= hotkey;
    }
    return failed;
};

// Apply new settings to the running app. Returns an error message, or null.
const applySettings = (next: Settings): string | null => {
    const prev = settings;
    const bufferChanged =
        next.fps !== prev.fps || next.clipSeconds !== prev.clipSeconds;

    if (next.hotkey === next.recordHotkey) {
        return "The clip and recording hotkeys must be different";
    }
    // Restarting ffmpeg would cut the recording off
    if (recording && bufferChanged) {
        return "Stop the recording before changing clip length or frame rate";
    }

    // Hotkeys first: if a new one can't be registered, change nothing
    if (next.hotkey !== prev.hotkey || next.recordHotkey !== prev.recordHotkey) {
        globalShortcut.unregisterAll();
        const failed = registerHotkeys(next);
        if (failed) {
            globalShortcut.unregisterAll();
            registerHotkeys(prev);
            return `Couldn't use hotkey "${failed}" (invalid or taken by another app)`;
        }
    } else {
        // Same hotkeys, but one may have failed at startup: try again
        registerHotkeys(next);
    }

    settings = next;
    saveSettings(settings);
    updateTray();

    // The buffer length and frame rate are baked into the ffmpeg command
    if (bufferChanged) restartBuffer();

    return null;
};

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
    app.quit();
}

// Only allow one copy of the app to run at a time
if (!app.requestSingleInstanceLock()) {
    app.exit(0);
}

const openSettings = () => {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    } else {
        settingsWindow = new BrowserWindow({
            width: 420,
            height: 420,
            useContentSize: true,
            resizable: false,
            title: "Momentr Settings",
            autoHideMenuBar: true,
            webPreferences: { preload: path.join(__dirname, "preload.cjs") },
        });
    }

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        settingsWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
        settingsWindow.loadFile(
            path.join(
                __dirname,
                `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
            ),
        );
    }

    settingsWindow.on("closed", () => {
        settingsWindow = null;
        // In case the window closed while it was capturing a new hotkey
        registerHotkeys(settings);
    });
};

// Messages from the settings window (sent through preload.ts)
const registerIpc = () => {
    ipcMain.handle("settings:get", () => settings);

    // The settings window is listening for a new hotkey: let the current ones
    // reach the window instead of saving a clip or starting a recording
    ipcMain.on("hotkey:pause", (_event, paused: boolean) => {
        if (paused) globalShortcut.unregisterAll();
        else registerHotkeys(settings);
    });

    ipcMain.handle("settings:save", (_event, input: Partial<Settings>) => {
        const cleaned = cleanSettings(input, settings);
        const error = applySettings(cleaned);
        if (!error) console.log("Settings applied:", cleaned);
        // Send back what's actually in use, so the form can show it
        return { settings, error };
    });

    ipcMain.handle("settings:chooseFolder", async (_event, current: string) => {
        const options: Electron.OpenDialogOptions = {
            defaultPath: current,
            properties: ["openDirectory", "createDirectory"],
        };
        const result = settingsWindow
            ? await dialog.showOpenDialog(settingsWindow, options)
            : await dialog.showOpenDialog(options);
        return result.canceled ? null : result.filePaths[0];
    });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
    registerIpc();
    startBuffer();
    createTray();

    const failed = registerHotkeys(settings);
    if (failed) {
        console.error(
            `Could not register ${failed} (another app may be using it)`,
        );
    }
});

// Keep running in the tray when windows are closed; quit only from the tray menu
app.on("window-all-closed", () => {});

app.on("will-quit", () => {
    quitting = true;
    // Save a recording in progress before ffmpeg stops
    finishRecordingNow();
    tray?.destroy();
    ffmpeg?.kill("SIGINT");
    globalShortcut.unregisterAll();
});
