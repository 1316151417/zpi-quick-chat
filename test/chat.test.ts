import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Chat } from "../src/chat.ts";
import type { Options } from "@zpi-dev/agent-sdk";
import { server, type ServerOptions } from "./server.ts";
const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
test("the default cwd is the user's home directory", () => {
  const chat = new Chat({ model: "deepseek", reasoning: "disable", apiKey: "synthetic" }, () => {});
  assert.equal(chat.snapshot().cwd, homedir());
});
async function fixture(options: ServerOptions & { model?: string; nativeDeepSeek?: boolean; persistSession?: boolean; maxTurns?: number; requestOptions?: NonNullable<Options["zpi"]>["requestOptions"] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "zpi-quick-chat-unit-")),
    api = await server(options);
  const chat = new Chat({ model: "deepseek", reasoning: "disable", apiKey: "synthetic" }, () => {}, {
    model: options.model ?? (options.nativeDeepSeek ? "deepseek" : "test"),
    cwd: dir,
    persistSession: options.persistSession,
    maxTurns: options.maxTurns,
    zpi: {
      agentDir: dir,
      requestOptions: options.requestOptions,
      fetch: (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin === "https://api.deepseek.com" && /^\/v1\/tools\/(search|fetch)$/.test(url.pathname))
          return fetch(new URL(url.pathname, api.url), init);
        if (options.nativeDeepSeek && url.origin === "https://api.deepseek.com" && url.pathname === "/anthropic/v1/messages")
          return fetch(new URL(url.pathname, api.url), init);
        if (url.origin !== new URL(api.url).origin) throw new Error("External network is disabled in tests");
        return fetch(input, init);
      },
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
test("the packaged SDK keeps multi-turn chat in memory even when persistence is overridden", async () => {
  const { dir, api, chat, close } = await fixture({ persistSession: true });
  try {
    chat.send("Translate hello");
    await waitFor(() => !chat.snapshot().busy);
    assert.equal(chat.snapshot().messages.at(-1)?.text, "你好，世界");
    assert.equal(chat.snapshot().error, undefined);
    assert.equal((await readdir(dir)).includes("sessions"), false);
    chat.send("Continue");
    await waitFor(() => !chat.snapshot().busy);
    assert.equal(chat.snapshot().messages.at(-1)?.text, "继续对话");
    assert.match(JSON.stringify(api.requests[1].messages), /Translate hello/);
    assert.equal(api.requests[0].tools, undefined);
    for (const request of api.requests) {
      assert.match(JSON.stringify(request.messages), /zpi\.environment|<cwd>/);
      assert.ok(JSON.stringify(request.messages).includes(dir));
      assert.doesNotMatch(JSON.stringify(request.messages), /当前工作目录/);
    }
    assert.equal((await readdir(dir)).includes("sessions"), false);
    assert.throws(() => chat.send("", []), /请输入/);
    assert.throws(() => chat.send("x", [{ name: "bad", data: "!", mimeType: "image/png" }]), /图片/);
    await chat.reset();
    assert.equal(chat.snapshot().messages.length, 0);
    assert.equal((await readdir(dir)).includes("sessions"), false);
  } finally {
    await close();
  }
});

test("the production DeepSeek transport keeps the SDK cwd context in plain and web-only conversations", async (t) => {
  for (const web of [false, true]) await t.test(web ? "web only" : "plain chat", async () => {
    const f = await fixture({ nativeDeepSeek: true, calls: web ? [
      { name: "web_search", input: { query: "测试来源" } },
      { name: "web_fetch", input: { url: "https://example.com/source" } },
    ] : [] });
    try {
      f.chat.configure({ web, bash: false });
      f.chat.send("你好");
      await waitFor(() => !f.chat.snapshot().busy);
      assert.equal(f.chat.snapshot().error, undefined);
      assert.equal(f.api.requests[0].model, "deepseek-flash");
      assert.ok(Array.isArray(f.api.requests[0].system), "Exercise the real DeepSeek Anthropic transport");
      f.chat.send("你在什么目录？");
      await waitFor(() => !f.chat.snapshot().busy);
      assert.equal(f.chat.snapshot().error, undefined);
      assert.equal(f.api.requests.length, web ? 4 : 2);
      for (const request of f.api.requests) {
        assert.match(JSON.stringify(request), /zpi\.environment/);
        assert.ok(JSON.stringify(request).includes(f.dir));
        assert.doesNotMatch(JSON.stringify(request), /当前工作目录/);
        assert.match(JSON.stringify(request.system), /你是一个有用的助手/);
      }
    } finally { await f.close(); }
  });
});

test("tool choices lock only after accepted input, and reset clears both choices synchronously", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(f.chat.snapshot().tools, { web: false, bash: false });
    f.chat.configure({ web: true, bash: false });
    assert.throws(() => f.chat.send(""), /请输入/);
    f.chat.configure({ web: false, bash: true });
    f.chat.send("Hello");
    assert.throws(() => f.chat.configure({ web: true, bash: true }), /锁定/);
    await waitFor(() => !f.chat.snapshot().busy);
    assert.match(JSON.stringify(f.api.requests[0].messages), new RegExp(f.dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual((f.api.requests[0].tools as { function: { name: string } }[]).map((tool) => tool.function.name), ["Bash", "Read"]);
    const resetting = f.chat.reset();
    assert.deepEqual(f.chat.snapshot().tools, { web: false, bash: false });
    f.chat.configure({ web: true, bash: false });
    await resetting;
  } finally { await f.close(); }
});

test("Bash reuses the SDK runner, executes in the locked cwd, and preserves multi-round assistant text", async () => {
  const f = await fixture({ calls: [{ name: "Bash", input: { command: "printf 'proof' > proof.txt; pwd; cat proof.txt" } }] });
  try {
    f.chat.configure({ web: false, bash: true });
    f.chat.send("Run the fixture command");
    await waitFor(() => !f.chat.snapshot().busy);
    const assistant = f.chat.snapshot().messages.at(-1)!;
    assert.equal(f.chat.snapshot().error, undefined);
    assert.equal(await readFile(join(f.dir, "proof.txt"), "utf8"), "proof");
    assert.equal(assistant.text, "我先检查。\n\n继续对话");
    assert.equal(assistant.calls?.length, 1);
    assert.equal(assistant.status, "completed");
    assert.equal(assistant.calls![0].offset, "我先检查。".length);
    assert.match(assistant.calls![0].output!, /proof/);
    assert.ok(assistant.calls![0].output!.includes(f.dir));
    assert.notEqual(assistant.calls![0].error, true);
    assert.match(JSON.stringify(f.api.requests.at(-1)?.messages), /tool/);
  } finally { await f.close(); }
});

test("local tools find and read an image through SDK Read and retain it for follow-up questions", async (t) => {
  for (const nativeDeepSeek of [false, true]) await t.test(nativeDeepSeek ? "production DeepSeek" : "OpenAI compatible", async () => {
    const f = await fixture({ nativeDeepSeek });
    const file = join(f.dir, "local image.png"),
      data = "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWP4z8AAQVDqPwMDAEHSBfsYFwTiAAAAAElFTkSuQmCC";
    try {
      await writeFile(file, Buffer.from(data, "base64"));
      f.api.queueCalls([
        { name: "Bash", input: { command: "find . -maxdepth 1 -name '*.png' -print" } },
        { name: "Read", input: { file_path: file } },
      ], "图片已读取");
      f.chat.configure({ web: false, bash: true });
      f.chat.send("查找当前目录的图片并查看内容");
      await waitFor(() => !f.chat.snapshot().busy);
      assert.equal(f.chat.snapshot().error, undefined);
      const calls = f.chat.snapshot().messages.at(-1)!.calls!;
      assert.match(calls[0].output!, /local image\.png/);
      assert.equal(calls[1].name, "Read");
      assert.equal(calls[1].input, file);
      assert.notEqual(calls[1].error, true);
      assert.deepEqual(calls[1].images, [{ name: file, mimeType: "image/png", data }]);
      const tools = f.api.requests[0].tools as { name?: string; function?: { name: string } }[];
      assert.deepEqual(tools.map((tool) => tool.name ?? tool.function?.name), ["Bash", "Read"]);
      assert.ok(JSON.stringify(f.api.requests[2].messages).includes(data), "The model receives image bytes from the real file");
      assert.match(JSON.stringify(f.api.requests[2].messages), nativeDeepSeek ? /"type":"image"/ : /"type":"image_url"/);
      f.chat.send("继续分析刚才读取的图片");
      await waitFor(() => !f.chat.snapshot().busy);
      assert.equal(f.chat.snapshot().error, undefined);
      assert.ok(JSON.stringify(f.api.requests.at(-1)?.messages).includes(data));
      await f.chat.reset();
      assert.equal(f.chat.snapshot().messages.length, 0);
      assert.deepEqual(f.chat.snapshot().tools, { web: false, bash: false });
    } finally { await f.close(); }
  });
});

test("a failed SDK Read shows the file path and error and permits a follow-up", async () => {
  const f = await fixture({ nativeDeepSeek: true });
  try {
    const file = join(f.dir, "missing.png");
    f.api.queueCalls([{ name: "Read", input: { file_path: file } }], "读取失败");
    f.chat.configure({ web: false, bash: true });
    f.chat.send("读取不存在的图片");
    await waitFor(() => !f.chat.snapshot().busy);
    const call = f.chat.snapshot().messages.at(-1)!.calls![0];
    assert.equal(call.input, file);
    assert.equal(call.error, true);
    assert.match(call.output!, /ENOENT|no such file/i);
    assert.equal(call.images, undefined);
    f.chat.send("继续");
    await waitFor(() => !f.chat.snapshot().busy);
    assert.equal(f.chat.snapshot().error, undefined);
  } finally { await f.close(); }
});

test("Read is unavailable until local tools are enabled, including in web-only sessions", async (t) => {
  for (const web of [false, true]) await t.test(web ? "web only" : "plain chat", async () => {
    const f = await fixture({ nativeDeepSeek: true });
    try {
      const file = join(f.dir, "private.txt"), contents = "read-disabled-fixture-content";
      await writeFile(file, contents);
      f.api.queueCalls([{ name: "Read", input: { file_path: file } }], "完成");
      f.chat.configure({ web, bash: false });
      f.chat.send("本机工具未启用");
      await waitFor(() => !f.chat.snapshot().busy);
      assert.ok(!(f.api.requests[0].tools as { name: string }[] | undefined)?.some((tool) => tool.name === "Read"));
      assert.equal(f.chat.snapshot().messages.at(-1)?.calls?.[0].error, true);
      assert.ok(!JSON.stringify(f.api.requests).includes(contents));
    } finally { await f.close(); }
  });
});

test("long tool runs can exceed twelve model rounds and continue in the same conversation", async (t) => {
  for (const nativeDeepSeek of [false, true]) await t.test(nativeDeepSeek ? "production DeepSeek" : "OpenAI compatible", async () => {
    const f = await fixture({ nativeDeepSeek, calls: Array.from({ length: 14 }, (_, index) => ({
      name: "Bash", input: { command: `printf 'round ${index + 1}'` },
    })), reply: "任务完成" });
    try {
      f.chat.configure({ web: false, bash: true });
      f.chat.send("执行多轮测试命令");
      await waitFor(() => !f.chat.snapshot().busy);
      assert.equal(f.chat.snapshot().error, undefined);
      assert.equal(f.chat.snapshot().messages.at(-1)?.calls?.length, 14);
      assert.equal(f.chat.snapshot().messages.at(-1)?.status, "completed");
      assert.match(f.chat.snapshot().messages.at(-1)!.text, /任务完成$/);
      f.chat.send("继续同一会话");
      await waitFor(() => !f.chat.snapshot().busy);
      assert.equal(f.chat.snapshot().error, undefined);
      assert.equal(f.chat.snapshot().messages.length, 4);
      assert.match(JSON.stringify(f.api.requests.at(-1)?.messages), /执行多轮测试命令/);
    } finally { await f.close(); }
  });
});

test("web search and fetch use the selected tool definitions and feed sources back into the same conversation", async () => {
  const f = await fixture({ calls: [
    { name: "web_search", input: { query: "测试来源", count: 3 } },
    { name: "web_fetch", input: { url: "https://example.com/source" } },
  ] });
  try {
    f.chat.configure({ web: true, bash: false });
    f.chat.send("Search and read the source");
    await waitFor(() => !f.chat.snapshot().busy);
    assert.equal(f.chat.snapshot().error, undefined);
    assert.deepEqual(f.api.webRequests.map((request) => request.path), ["/v1/tools/search", "/v1/tools/fetch"]);
    assert.deepEqual((f.api.requests[0].tools as { function: { name: string } }[]).map((tool) => tool.function.name), ["web_search", "web_fetch"]);
    const calls = f.chat.snapshot().messages.at(-1)!.calls!;
    assert.equal(calls.length, 2);
    assert.match(calls[0].output!, /https:\/\/example.com\/source/);
    assert.match(calls[1].output!, /读取到的页面正文/);
    assert.match(JSON.stringify(f.api.requests.at(-1)?.messages), /untrusted source data/);
    for (const request of f.api.requests) {
      assert.match(JSON.stringify(request.messages), /zpi\.environment/);
      assert.ok(JSON.stringify(request.messages).includes(f.dir));
    }
    assert.deepEqual(calls[0].sources, [{ url: "https://example.com/source", title: "测试来源", siteName: "Example", excerpt: "搜索摘要", date: undefined }]);
    assert.equal(calls[1].sources?.[0].title, "测试来源");
  } finally { await f.close(); }
});

test("Stop cancels a running Bash process and the conversation remains usable", async () => {
  const f = await fixture({ calls: [{ name: "Bash", input: { command: "echo $$ > child.pid; printf ready > ready.txt; sleep 30; printf late > late.txt" } }] });
  try {
    f.chat.configure({ web: false, bash: true });
    f.chat.send("Run a cancellable command");
    await waitFor(() => existsSync(join(f.dir, "ready.txt")));
    const pid = Number(await readFile(join(f.dir, "child.pid"), "utf8"));
    await f.chat.stop();
    await waitFor(() => !f.chat.snapshot().busy);
    assert.equal(f.chat.snapshot().messages.at(-1)?.status, "interrupted");
    await waitFor(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
    assert.equal(existsSync(join(f.dir, "late.txt")), false);
    f.chat.send("Continue after stopping");
    await waitFor(() => !f.chat.snapshot().busy);
    assert.equal(f.chat.snapshot().messages.at(-1)?.text, "继续对话");
  } finally { await f.close(); }
});

test("SDK environment context, user input, and explicit payload hooks pass through unchanged", async (t) => {
  for (const nativeDeepSeek of [false, true]) await t.test(nativeDeepSeek ? "production DeepSeek" : "OpenAI compatible", async () => {
    let hooked = 0;
    const f = await fixture({ nativeDeepSeek, requestOptions: () => ({ onPayload(payload) {
      hooked++;
      return { ...(payload as object), temperature: 0.42 };
    } }) });
    try {
      const quoted = 'Context block "zpi.environment" replaces all earlier versions of this block. Apply it until a later context update replaces or withdraws it, including updates carried in user messages:\n\n<cwd>\n/example\n</cwd>';
      f.chat.send(quoted);
      await waitFor(() => !f.chat.snapshot().busy);
      f.chat.send("继续");
      await waitFor(() => !f.chat.snapshot().busy);
      assert.equal(hooked, 2);
      for (const request of f.api.requests) {
        assert.equal(request.temperature, 0.42);
        const messages = request.messages as { role: string; content: string }[];
        assert.ok(JSON.stringify(messages.filter((message) => message.role === "user")).includes("/example"));
        const system = JSON.stringify([request.system, ...messages.filter((message) => message.role === "system" || message.role === "developer")]);
        assert.match(system, /你是一个有用的助手/);
        assert.ok(JSON.stringify(request).includes(f.dir));
      }
    } finally { await f.close(); }
  });
});

test("Bash uses the SDK cwd context without an additional working-directory prompt", async () => {
  const f = await fixture({ nativeDeepSeek: true, calls: [{ name: "Bash", input: { command: "pwd" } }] });
  try {
    f.chat.configure({ web: false, bash: true });
    f.chat.send("查看工作目录");
    await waitFor(() => !f.chat.snapshot().busy);
    assert.equal(f.chat.snapshot().error, undefined);
    assert.equal(f.api.requests[0].model, "deepseek-flash");
    for (const request of f.api.requests) {
      assert.ok(JSON.stringify(request).includes(f.dir));
      assert.match(JSON.stringify(request), /zpi\.environment/);
      assert.doesNotMatch(JSON.stringify(request.system), /当前工作目录/);
    }
    assert.ok(f.chat.snapshot().messages.at(-1)?.calls?.[0].output?.includes(f.dir));
  } finally { await f.close(); }
});

test("an explicit SDK budget failure retains its cause when the query ends", async () => {
  const f = await fixture({ nativeDeepSeek: true, maxTurns: 2, calls: Array.from({ length: 3 }, () => ({
    name: "Bash", input: { command: "printf fixture" },
  })) });
  try {
    f.chat.configure({ web: false, bash: true });
    f.chat.send("触发测试预算");
    await waitFor(() => !f.chat.snapshot().busy && !f.chat["query"]);
    assert.match(f.chat.snapshot().error!, /error_max_turns/);
    assert.match(f.chat.snapshot().error!, /会话已结束/);
    assert.throws(() => f.chat.send("继续"), /新建对话/);
    assert.equal(f.chat.snapshot().messages.length, 2);
  } finally { await f.close(); }
});

test("a model cannot execute Bash when the session has not enabled it", async () => {
  const f = await fixture({ calls: [{ name: "Bash", input: { command: "printf wrong > unexpected.txt" } }] });
  try {
    f.chat.send("A tool-free conversation");
    await waitFor(() => !f.chat.snapshot().busy);
    assert.equal(existsSync(join(f.dir, "unexpected.txt")), false);
    assert.equal(f.api.requests[0].tools, undefined);
  } finally { await f.close(); }
});

test("reset cancels an old Bash run without locking or modifying the replacement conversation", async () => {
  const f = await fixture({ calls: [{ name: "Bash", input: { command: "printf ready > ready.txt; sleep 30; printf late > late.txt" } }] });
  try {
    f.chat.configure({ web: false, bash: true });
    f.chat.send("Old command");
    await waitFor(() => existsSync(join(f.dir, "ready.txt")));
    const resetting = f.chat.reset();
    assert.deepEqual(f.chat.snapshot().tools, { web: false, bash: false });
    f.chat.configure({ web: true, bash: false });
    f.chat.send("New question");
    await resetting;
    await waitFor(() => !f.chat.snapshot().busy);
    assert.equal(f.chat.snapshot().messages.length, 2);
    assert.equal(f.chat.snapshot().messages[0].text, "New question");
    assert.equal(existsSync(join(f.dir, "late.txt")), false);
    assert.deepEqual(f.chat.snapshot().tools, { web: true, bash: false });
    assert.equal(f.chat.snapshot().messages.at(-1)?.calls, undefined);
  } finally { await f.close(); }
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

test("reset publishes synchronously and late cleanup cannot clear a new conversation", async () => {
  const f = await fixture();
  const cleanup = Promise.withResolvers<void>();
  try {
    f.chat.send("Old question");
    await waitFor(() => !f.chat.snapshot().busy);
    f.chat["loop"] = cleanup.promise;
    const resetting = f.chat.reset();
    // No microtask or old-query cleanup may precede the new empty snapshot.
    assert.equal(f.chat.snapshot().messages.length, 0);
    assert.equal(f.chat.snapshot().generation, 1);
    assert.equal(f.chat.snapshot().busy, false);
    f.chat.send("New question");
    cleanup.resolve();
    await resetting;
    await waitFor(() => !f.chat.snapshot().busy);
    assert.equal(f.chat.snapshot().messages[0].text, "New question");
    assert.doesNotMatch(JSON.stringify(f.api.requests.at(-1)?.messages), /Old question/);
  } finally {
    cleanup.resolve();
    await f.close();
  }
});

test("streaming can stop, resume, and reset without leaking old deltas", async () => {
  const f = await fixture({ hold: true });
  try {
    f.chat.send("First question");
    await waitFor(() => f.chat.snapshot().messages.at(-1)?.text === "你好，世界");
    assert.equal(f.chat.snapshot().busy, true);
    await f.chat.stop();
    await waitFor(() => !f.chat.snapshot().busy);
    f.chat.send("Continue after stop");
    await waitFor(() => f.chat.snapshot().messages.at(-1)?.text === "继续对话");
    const resetting = f.chat.reset();
    assert.equal(f.chat.snapshot().messages.length, 0);
    f.chat.send("Fresh question");
    await resetting;
    await waitFor(() => f.chat.snapshot().messages.at(-1)?.text === "继续对话");
    assert.equal(f.chat.snapshot().messages.length, 2);
    assert.equal(f.chat.snapshot().messages[0].text, "Fresh question");
    assert.doesNotMatch(JSON.stringify(f.api.requests.at(-1)?.messages), /First question|Continue after stop/);
  } finally {
    await f.close();
  }
});
