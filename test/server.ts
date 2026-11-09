import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
export async function server(options: { failFirst?: boolean; hold?: boolean; delayMs?: number } = {}) {
  const requests: Record<string, unknown>[] = [];
  const sockets = new Set<import("node:net").Socket>();
  const http = createServer(async (request, response) => {
    let body = "";
    for await (const value of request) body += value;
    requests.push(JSON.parse(body));
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
    const chunk = (delta: unknown, finish: string | null = null) =>
      `data: ${JSON.stringify({ id: "reply", object: "chat.completion.chunk", model: "test", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const text = requests.length === 1 ? "你好，世界" : "继续对话";
    response.write(chunk({ role: "assistant" }));
    for (const content of options.delayMs ? [...text] : [text]) {
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
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
