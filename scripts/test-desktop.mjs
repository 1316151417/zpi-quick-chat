import { spawn } from "node:child_process";
if (process.argv.slice(2).some((arg) => ["--ui", "--debug", "--headed"].includes(arg)))
  throw new Error("Desktop tests must remain hidden");
const env = { ...process.env, PLAYWRIGHT_HTML_OPEN: "never" };
delete env.PWDEBUG;
const child = spawn(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
  { env, stdio: "inherit" },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
