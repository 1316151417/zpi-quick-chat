import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Chat } from "../src/chat.ts";
import { server } from "./server.ts";
const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
async function fixture(options: { model?: string; failFirst?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "zpi-quick-chat-unit-")),
    api = await server(options);
  const chat = new Chat({ model: "deepseek", reasoning: "disable", apiKey: "synthetic" }, () => {}, {
    model: options.model ?? "test",
    zpi: {
      agentDir: dir,
      providers: {
        test: {
          apiKey: "synthetic",
          baseUrl: api.url,
          models: [
            {
              id: "test",
              name: "Test",
              input: ["text", "image"],
              reasoning: false,
              contextWindow: 128000,
              maxTokens: 4096,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    },
  });
  return {
    dir,
    api,
    chat,
    close: async () => {
      await chat.close();
      await api.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test("the packaged SDK drives streaming, in-memory multi-turn chat and reset", async () => {
  const { dir, api, chat, close } = await fixture();
  try {
    chat.send("Translate hello");
    await waitFor(() => !chat.snapshot().busy);
    assert.equal(chat.snapshot().messages.at(-1)?.text, "你好，世界");
    assert.equal(chat.snapshot().error, undefined);
    chat.send("Continue");
    await waitFor(() => !chat.snapshot().busy);
    assert.equal(chat.snapshot().messages.at(-1)?.text, "继续对话");
    assert.match(JSON.stringify(api.requests[1].messages), /Translate hello/);
    assert.equal(api.requests[0].tools, undefined);
    assert.throws(() => chat.send("", []), /请输入/);
    assert.throws(() => chat.send("x", [{ name: "bad", data: "!", mimeType: "image/png" }]), /图片/);
    await chat.reset();
    assert.equal(chat.snapshot().messages.length, 0);
    assert.equal((await readdir(dir)).includes("sessions"), false);
  } finally {
    await close();
  }
});

test("fatal query initialization requires a new conversation and never discards the visible history", async () => {
  const f = await fixture({ model: "missing-model" });
  try {
    f.chat.send("First question");
    await waitFor(() => !f.chat.snapshot().busy);
    assert.match(f.chat.snapshot().error ?? "", /新建对话/);
    const before = f.chat.snapshot();
    assert.throws(() => f.chat.send("Continue"), /新建对话/);
    assert.deepEqual(f.chat.snapshot(), before);
    await f.chat.reset();
    assert.equal(f.chat.snapshot().messages.length, 0);
    assert.equal(f.chat.snapshot().error, undefined);
  } finally {
    await f.close();
  }
});
test("an unexpectedly closed query releases busy state and requires reset", async () => {
  const f = await fixture();
  try {
    f.chat.send("First question");
    f.chat["query"]!.close();
    await waitFor(() => !f.chat.snapshot().busy);
    assert.match(f.chat.snapshot().error ?? "", /新建对话/);
    assert.throws(() => f.chat.send("Continue"), /新建对话/);
    assert.equal(f.chat.snapshot().messages.length, 2);
  } finally {
    await f.close();
  }
});
test("a normal SDK error result remains continuable with the same context", async () => {
  const f = await fixture({ failFirst: true });
  try {
    f.chat.send("Rejected question");
    await waitFor(() => !f.chat.snapshot().busy);
    assert.match(f.chat.snapshot().error ?? "", /Synthetic request rejected/);
    f.chat.send("Try again");
    await waitFor(() => !f.chat.snapshot().busy);
    assert.equal(f.chat.snapshot().error, undefined);
    assert.match(JSON.stringify(f.api.requests.at(-1)?.messages), /Rejected question/);
    assert.equal(f.chat.snapshot().messages.at(-1)?.text, "继续对话");
  } finally {
    await f.close();
  }
});
