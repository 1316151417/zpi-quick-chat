import { defineConfig } from "@playwright/test";
if (process.argv.some((arg) => ["--ui", "--debug", "--headed"].includes(arg)))
  throw new Error("Desktop tests must remain hidden");
process.env.PLAYWRIGHT_HTML_OPEN = "never";
export default defineConfig({
  testDir: "test",
  testMatch: "*.spec.ts",
  workers: 1,
  timeout: 30000,
  reporter: "list",
});
