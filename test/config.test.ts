import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readConfig } from "../src/config.ts";
test("defaults and supported configuration are deterministic", () => {
  assert.deepEqual(readConfig({ DEEPSEEK_API_KEY: "key" }), {
    model: "deepseek",
    reasoning: "disable",
    apiKey: "key",
  });
  assert.equal(
    readConfig({ DEEPSEEK_API_KEY: "key", ZPI_QUICK_CHAT_REASONING: "low" }).reasoning,
    "low",
  );
  assert.throws(() => readConfig({}), /DEEPSEEK_API_KEY is required/);
  assert.throws(
    () => readConfig({ DEEPSEEK_API_KEY: "key", ZPI_QUICK_CHAT_MODEL: "other" }),
    /only deepseek/,
  );
  assert.throws(
    () => readConfig({ DEEPSEEK_API_KEY: "key", ZPI_QUICK_CHAT_REASONING: "high" }),
    /disable or low/,
  );
});
test("CLI fails before launching Electron when its key is missing", () => {
  const env = { ...process.env };
  delete env.DEEPSEEK_API_KEY;
  delete env.ZPI_QUICK_CHAT_MODEL;
  delete env.ZPI_QUICK_CHAT_REASONING;
  const result = spawnSync(process.execPath, ["bin/cli.mjs"], {
    env,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DEEPSEEK_API_KEY is required/);
});
