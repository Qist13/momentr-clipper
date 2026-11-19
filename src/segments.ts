// Helpers for the .ts segment files that ffmpeg writes
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type Segment = { name: string; time: number };

// All .ts files in a folder, sorted oldest -> newest by modification time
export const listSegments = (dir: string): Segment[] =>
    fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".ts"))
        .map((name) => ({
            name,
            time: fs.statSync(path.join(dir, name)).mtimeMs,
        }))
        .sort((a, b) => a.time - b.time);

// Writes the concat list next to the segments and returns ffmpeg's arguments
const prepareConcat = (dir: string, names: string[], outPath: string) => {
    const listPath = path.join(dir, "list.txt");
    fs.writeFileSync(listPath, names.map((n) => `file '${n}'`).join("\n"));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    // Join the segments without re-encoding
    return [
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
    ];
};

// Join segments (in the given order) into one mp4. Resolves true on success.
export const concatSegments = (
    dir: string,
    names: string[],
    outPath: string,
): Promise<boolean> =>
    new Promise((resolve) => {
        const concat = spawn("ffmpeg", prepareConcat(dir, names, outPath));
        concat.stderr?.on("data", (data) =>
            console.error("[concat]", data.toString()),
        );
        concat.on("exit", (code) => resolve(code === 0));
        concat.on("error", () => resolve(false));
    });

// Same, but blocks until done. Only for use while the app is quitting.
export const concatSegmentsSync = (
    dir: string,
    names: string[],
    outPath: string,
): boolean =>
    spawnSync("ffmpeg", prepareConcat(dir, names, outPath)).status === 0;

// "2026-11-18T14-03-22", safe for file names
export const timestamp = () =>
    new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
