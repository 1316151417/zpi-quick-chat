#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("-v")) {
  console.log(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
  process.exit(0);
}
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: zpi-quick-chat [--version] [--help]\n\nStart ZPI Quick Chat. Set DEEPSEEK_API_KEY first.");
  process.exit(0);
}
const { readConfig } = await import("../dist/config.js");
try {
  readConfig(process.env);
} catch (error) {
  console.error(`zpi-quick-chat: ${error.message}`);
  process.exit(1);
}
if (process.platform !== "darwin") {
  console.error("zpi-quick-chat currently supports macOS");
  process.exit(1);
}
const require = createRequire(import.meta.url);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  require("electron"),
  [fileURLToPath(new URL("../dist/main.js", import.meta.url)), ...args],
  { env, stdio: "inherit" },
);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (!stopping) {
      stopping = true;
      child.kill("SIGTERM");
    }
  });
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = stopping ? 0 : (code ?? 1);
});
