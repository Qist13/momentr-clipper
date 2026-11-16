import { app, BrowserWindow, globalShortcut } from "electron";
import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import started from "electron-squirrel-startup";

const SEGMENT_SECONDS = 2;
const CLIP_SECONDS = 30;
const BUFFER_SEGMENTS = CLIP_SECONDS / SEGMENT_SECONDS + 5;

let ffmpeg: ChildProcess | null = null;

// Store segments in the app's own data folder, not the project folder
const bufferDir = path.join(app.getPath("userData"), "buffer");

const startBuffer = () => {
    // Remove old segments from the last run, then create the folder fresh
    fs.rmSync(bufferDir, { recursive: true, force: true });
    fs.mkdirSync(bufferDir, { recursive: true });

    const display = process.env.DISPLAY ?? ":0";

    const args = [
        "-loglevel",
        "warning",
        "-nostats",
        "-f",
        "x11grab",
        "-framerate",
        "30",
        "-video_size",
        "1920x1080",
        "-i",
        display,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "60",
        "-sc_threshold",
        "0",
        "-f",
        "segment",
        "-segment_time",
        String(SEGMENT_SECONDS),
        "-segment_wrap",
        String(BUFFER_SEGMENTS),
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
    const wanted = finished.slice(-(CLIP_SECONDS / SEGMENT_SECONDS));

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

    // Pick where the clip goes
    const clipsDir = path.join(app.getPath("videos"), "Momentr");
    fs.mkdirSync(clipsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const outPath = path.join(clipsDir, `clip_${stamp}.mp4`);

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
        if (code === 0) console.log("Clip saved:", outPath);
        else console.error("Clip failed, ffmpeg exit code", code);
    });
};

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
    app.quit();
}

// Only allow one copy of the app to run at a time
if (!app.requestSingleInstanceLock()) {
    app.quit();
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
    createWindow();
    startBuffer();

    const ok = globalShortcut.register("F8", saveClip);

    if (!ok) {
        console.error("Could not register F8 (another app may be using it)");
    }

    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("will-quit", () => {
    ffmpeg?.kill("SIGINT");
    globalShortcut.unregisterAll();
});
