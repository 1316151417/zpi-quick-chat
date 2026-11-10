import assert from "node:assert/strict";
import { test } from "node:test";
import { publicWebUrl, webTools } from "../src/web.ts";

const resultText = (result: Awaited<ReturnType<ReturnType<typeof webTools>[number]["execute"]>>) =>
  result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
function fixture(requestFetch: typeof fetch) {
  const tools = webTools("test-key", requestFetch);
  return (name: string, input: unknown, signal?: AbortSignal) =>
    tools.find((tool) => tool.name === name)!.execute("test-call", input, signal, undefined, {} as never);
}
const source = (content = "正文") => ({ results: [{
  title: "来源", url: "https://example.com/source", snippet: "摘要", summary: "来源摘要", content,
  site_name: "Example", site_icon: null, date: null, rerank_score: 2, authority: 3,
}] });

test("public links reject credentials, private addresses, and non-web schemes", () => {
  assert.equal(publicWebUrl("https://example.com/source"), "https://example.com/source");
  for (const url of ["https:example.com", "javascript:alert(1)", "file:///etc/hosts", "https://user:pass@example.com", "http://127.0.0.1", "http://2130706433", "http://0x7f000001", "http://192.168.1.2", "http://[::1]", "http://[::ffff:127.0.0.1]", "https://localhost", "https://host.internal"])
    assert.equal(publicWebUrl(url), null, url);
});

test("search preserves ZPI arguments, bounds source text, and redacts credentials", async () => {
  let body: unknown, authorization: string | null = null;
  const execute = fixture(async (input, init) => {
    assert.equal(String(input), "https://api.deepseek.com/v1/tools/search");
    authorization = new Headers(init?.headers).get("authorization");
    body = JSON.parse(String(init?.body));
    return Response.json(source("test-key\n" + "长内容🙂".repeat(15000)));
  });
  const input = { query: "测试🙂", count: 3, need_content: true, ori_question: null };
  const result = await execute("web_search", input);
  assert.equal(result.isError, undefined);
  assert.deepEqual(body, input);
  assert.equal(authorization, "Bearer test-key");
  const text = resultText(result);
  assert.ok(text.length <= 32000);
  assert.match(text, /untrusted source data/);
  assert.match(text, /https:\/\/example.com\/source/);
  assert.doesNotMatch(text, /test-key/);
  assert.match(text, /redacted/);
  const value = JSON.parse(text.slice(text.indexOf("{"))) as { truncated: boolean };
  assert.equal(value.truncated, true);
});

test("invalid inputs and an already-cancelled request never reach the network", async () => {
  let requests = 0;
  const execute = fixture(async () => { requests++; return Response.json(source()); });
  for (const input of [{ query: " " }, { query: "x", count: 51 }, { query: "x", extra: true }])
    assert.equal((await execute("web_search", input)).isError, true);
  assert.equal((await execute("web_fetch", { url: "http://127.0.0.1" })).isError, true);
  const abort = new AbortController();
  abort.abort();
  assert.match(resultText(await execute("web_search", { query: "x" }, abort.signal)), /已停止/);
  assert.equal(requests, 0);
});

test("fetch keeps its source and bounds the page without splitting a surrogate pair", async () => {
  const execute = fixture(async () => Response.json({ title: "页面", content: "🙂".repeat(32000) }));
  const text = resultText(await execute("web_fetch", { url: "https://example.com/source" }));
  assert.ok(text.length <= 32000);
  assert.match(text, /URL: https:\/\/example.com\/source/);
  assert.match(text, /truncated/);
  assert.equal(text.isWellFormed(), true);
});

test("temporary HTTP errors retry, while oversized responses stop at the transport bound", async () => {
  let requests = 0;
  const execute = fixture(async () => ++requests < 3
    ? new Response("busy", { status: 503, headers: { "retry-after": "0" } })
    : Response.json(source()));
  assert.equal((await execute("web_search", { query: "x" })).isError, undefined);
  assert.equal(requests, 3);
  const oversized = fixture(async () => new Response("large", { headers: { "content-length": String(2 * 1024 * 1024 + 1) } }));
  assert.match(resultText(await oversized("web_search", { query: "x" })), /2 MiB/);
});

test("cancelling a streamed web response stops reading and reaches the caller", async () => {
  const abort = new AbortController(), reading = Promise.withResolvers<void>();
  const execute = fixture(async (_input, init) => new Response(new ReadableStream({
    start(controller) {
      init!.signal!.addEventListener("abort", () => controller.error(init!.signal!.reason), { once: true });
      reading.resolve();
    },
  })));
  const pending = execute("web_search", { query: "x" }, abort.signal);
  await reading.promise;
  abort.abort();
  assert.match(resultText(await pending), /已停止/);
});
