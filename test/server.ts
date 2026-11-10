import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
export interface ServerOptions {
  failFirst?: boolean;
  hold?: boolean;
  delayMs?: number;
  chunkSize?: number;
  initialDelayMs?: number;
  calls?: { name: string; input: Record<string, unknown> }[];
  reply?: string;
}
export async function server(options: ServerOptions = {}) {
  const requests: Record<string, unknown>[] = [];
  const webRequests: { path: string; input: unknown }[] = [];
  let callIndex = 0;
  const sockets = new Set<import("node:net").Socket>();
  const http = createServer(async (request, response) => {
    let body = "";
    for await (const value of request) body += value;
    if (request.url?.startsWith("/v1/tools/")) {
      webRequests.push({ path: request.url, input: JSON.parse(body) });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(request.url.endsWith("/search") ? { results: [{
        title: "测试来源", url: "https://example.com/source", snippet: "搜索摘要", summary: "来源摘要",
        content: "来源正文", site_name: "Example", site_icon: null, date: null, rerank_score: 2, authority: 3,
      }] } : { title: "测试来源", content: "读取到的页面正文" }));
      return;
    }
    requests.push(JSON.parse(body));
    if (options.initialDelayMs) await setTimeout(options.initialDelayMs);
    if (response.destroyed) return;
    if (options.failFirst && requests.length === 1) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: { message: "Synthetic request rejected", type: "invalid_request_error" },
        }),
      );
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    const call = options.calls?.[callIndex++];
    if (request.url?.endsWith("/messages")) {
      const event = (value: { type: string; [key: string]: unknown }) => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;
      const text = call ? "我先检查。" : options.reply ?? (requests.length === 1 ? "你好，世界" : "继续对话");
      response.end([
        { type: "message_start", message: { id: `reply-${requests.length}`, type: "message", role: "assistant", model: "deepseek-flash", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
        { type: "content_block_stop", index: 0 },
        ...(call ? [
          { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: `call-${requests.length}`, name: call.name, input: {} } },
          { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: JSON.stringify(call.input) } },
          { type: "content_block_stop", index: 1 },
        ] : []),
        { type: "message_delta", delta: { stop_reason: call ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
        { type: "message_stop" },
      ].map(event).join(""));
      return;
    }
    const chunk = (delta: unknown, finish: string | null = null) =>
      `data: ${JSON.stringify({ id: "reply", object: "chat.completion.chunk", model: "test", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    if (call) {
      response.end(chunk({ role: "assistant", content: "我先检查。" }) + chunk({ tool_calls: [{
        index: 0, id: `call-${requests.length}`, type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.input) },
      }] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n");
      return;
    }
    const text = options.reply ?? (requests.length === 1 ? "你好，世界" : "继续对话");
    response.write(chunk({ role: "assistant" }));
    const characters = [...text], size = options.chunkSize ?? 1;
    const chunks = options.delayMs ? Array.from({ length: Math.ceil(characters.length / size) }, (_, index) => characters.slice(index * size, (index + 1) * size).join("")) : [text];
    for (const content of chunks) {
      if (response.destroyed) return;
      response.write(chunk({ content }));
      if (options.delayMs) await setTimeout(options.delayMs);
    }
    if (!options.hold) response.end(chunk({}, "stop") + "data: [DONE]\n\n");
  });
  http.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    webRequests,
    queueCalls(calls: NonNullable<ServerOptions["calls"]>, reply: string, stream?: Pick<ServerOptions, "delayMs" | "chunkSize" | "hold" | "initialDelayMs">) {
      options.calls = calls;
      options.reply = reply;
      Object.assign(options, stream);
      callIndex = 0;
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
