import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
await rm("dist", { recursive: true, force: true });
await mkdir("dist/native", { recursive: true });
await build({
  entryPoints: ["src/main.ts", "src/config.ts"],
  outdir: "dist",
  platform: "node",
  target: "node24",
  format: "esm",
  bundle: true,
  packages: "external",
});
await build({
  entryPoints: ["src/preload.ts"],
  outfile: "dist/preload.cjs",
  platform: "node",
  format: "cjs",
  bundle: true,
  external: ["electron"],
});
await build({
  entryPoints: ["src/renderer.ts"],
  outfile: "dist/renderer.js",
  platform: "browser",
  format: "esm",
  bundle: true,
});
await Promise.all([cp("src/index.html", "dist/index.html"), cp("src/style.css", "dist/style.css")]);
if (process.platform === "darwin") {
  const run = promisify(execFile);
  const common = [
    "clang",
    "-fobjc-arc",
    "-mmacosx-version-min=12.0",
    "-O2",
    "-framework",
    "AppKit",
  ];
  await run("xcrun", [
    ...common,
    "-framework",
    "ApplicationServices",
    "native/copy-selection.m",
    "-o",
    "dist/native/copy-selection",
  ]);
  await run("xcrun", [
    ...common,
    "-bundle",
    "-undefined",
    "dynamic_lookup",
    "-I",
    resolve(dirname(process.execPath), "../include/node"),
    "native/quick-chat-focus.m",
    "-o",
    "dist/native/quick-chat-focus.node",
  ]);
}
