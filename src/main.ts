import {
    app,
    BrowserWindow,
    globalShortcut,
    Menu,
    Notification,
    nativeImage,
    shell,
    Tray,
} from "electron";
import { spawn, ChildProcess } from "node:child_process";
import { loadSettings } from "./settings";
import fs from "node:fs";
import path from "node:path";
import started from "electron-squirrel-startup";

const SEGMENT_SECONDS = 2;

// Store segments in the app's own data folder, not the project folder
const bufferDir = path.join(app.getPath("userData"), "buffer");

let ffmpeg: ChildProcess | null = null;
let tray: Tray | null = null;
let settings = loadSettings();

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
                  "-f", "gdigrab",
                  "-framerate", String(settings.fps),
                  "-i", "desktop",
                  "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
              ]
            : [
                  "-f", "x11grab",
                  "-framerate", String(settings.fps),
                  "-video_size", "1920x1080",
                  "-i", process.env.DISPLAY ?? ":0",
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

const saveClip = () => {
    // All segments, sorted oldest -> newest by modification time
    const segments = fs
        .readdirSync(bufferDir)
        .filter((name) => name.endsWith(".ts"))
        .map((name) => ({
            name,
            time: fs.statSync(path.join(bufferDir, name)).mtimeMs,
        }))
        .sort((a, b) => a.time - b.time)
        .map((s) => s.name);

    // Leave out the newest (still being written), then take the last N
    const finished = segments.slice(0, -1);
    const wanted = finished.slice(-(settings.clipSeconds / SEGMENT_SECONDS));

    if (wanted.length === 0) {
        console.log("!!! Nothing recorded yet !!!");
        return;
    }

    // Write the concat list
    const listPath = path.join(bufferDir, "list.txt");
    fs.writeFileSync(
        listPath,
        wanted.map((name) => `file '${name}'`).join("\n"),
    );

    fs.mkdirSync(settings.clipsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const outPath = path.join(settings.clipsDir, `clip_${stamp}.mp4`);

    // Join the segments without re-encoding
    const concat = spawn("ffmpeg", [
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-i",
        listPath,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        outPath,
    ]);

    concat.stderr?.on("data", (data) =>
        console.error("[concat]", data.toString()),
    );
    concat.on("exit", (code) => {
        if (code === 0) {
            console.log("Clip saved:", outPath);
            const notification = new Notification({
                title: "Clip saved",
                body: path.basename(outPath),
            });
            notification.on("click", () => shell.openPath(outPath));
            notification.show();
        } else {
            console.error("Clip failed, ffmpeg exit code", code);
        }
    });
};

const createTray = () => {
    const icon = nativeImage.createFromPath(
        path.join(app.getAppPath(), "assets", "momentr.png"),
    );
    tray = new Tray(icon);

    tray.setToolTip("Momentr Clipper (recording)");
    tray.setContextMenu(
        Menu.buildFromTemplate([
            { label: `Save clip (${settings.hotkey})`, click: saveClip },
            {
                label: "Open clips folder",
                click: () => shell.openPath(settings.clipsDir),
            },
            { type: "separator" },
            { label: "Quit", click: () => app.quit() },
        ]),
    );
};

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
    app.quit();
}

// Only allow one copy of the app to run at a time
if (!app.requestSingleInstanceLock()) {
    app.exit(0);
}

const createWindow = () => {
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
        },
    });

    // and load the index.html of the app.
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
        mainWindow.loadFile(
            path.join(
                __dirname,
                `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
            ),
        );
    }

    // Open the DevTools.
    mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
    startBuffer();
    createTray();

    const ok = globalShortcut.register(settings.hotkey, saveClip);

    if (!ok) {
        console.error(
            `Could not register ${settings.hotkey} (another app may be using it)`,
        );
    }
});

// Keep running in the tray when windows are closed; quit only from the tray menu
app.on("window-all-closed", () => {});

app.on("will-quit", () => {
    tray?.destroy();
    ffmpeg?.kill("SIGINT");
    globalShortcut.unregisterAll();
});
