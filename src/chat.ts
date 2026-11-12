import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { query, type Options, type Query, type SDKMessage, type SDKUserMessage } from "@zpi-dev/agent-sdk";
import type { Config } from "./config.ts";
import { inputLimits, validateImages, validateText } from "./input.ts";
import type { ChatUpdate, ImageInput, Snapshot, ToolOptions } from "./types.ts";
import { webSources, webTools } from "./web.ts";

class Inputs implements AsyncIterable<SDKUserMessage> {
  private values: SDKUserMessage[] = [];
  private wake?: () => void;
  private closed = false;
  push(value: SDKUserMessage) {
    if (this.closed) throw new Error("Conversation closed");
    this.values.push(value);
    this.wake?.();
  }
  close() {
    this.closed = true;
    this.wake?.();
  }
  cancelPending() {
    if (!this.values.length) return false;
    this.values = [];
    return true;
  }
  async *[Symbol.asyncIterator]() {
    while (!this.closed) {
      if (this.values.length) yield this.values.shift()!;
      else
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
    }
  }
}
export class Chat {
  private input?: Inputs;
  private query?: Query;
  private loop?: Promise<void>;
  private state: Snapshot;
  private notify: (state: ChatUpdate) => void;
  private options: Options;
  private apiKey: string;
  private roundPrefix = "";
  private hasRoundText = false;
  constructor(config: Config, notify: (state: ChatUpdate) => void, overrides: Options = {}) {
    this.notify = notify;
    this.apiKey = config.apiKey;
    this.state = {
      generation: 0,
      messages: [],
      busy: false,
      model: config.model,
      reasoning: config.reasoning,
      tools: { web: false, bash: false },
      cwd: resolve(overrides.cwd ?? homedir()),
    };
    this.options = {
      model: config.model,
      env: { DEEPSEEK_API_KEY: config.apiKey },
      zpi: { requestOptions: { maxTokens: 16384, timeoutMs: 120000, maxRetries: 0 } },
      tools: [],
      settingSources: [],
      includePartialMessages: true,
      thinking: config.reasoning === "disable" ? { type: "disabled" } : { type: "adaptive" },
      effort: config.reasoning === "low" ? "low" : undefined,
      systemPrompt:
        "你是一个有用的助手，帮助用户完成任务。要求回复极简、本质、清晰、易懂。",
      ...overrides,
      // Quick Chat always keeps conversation history in memory, including test overrides.
      persistSession: false,
    };
  }
  get generation(): number {
    return this.state.generation;
  }
  snapshot(): Snapshot {
    return structuredClone(this.state);
  }
  private publish() {
    this.notify(this.snapshot());
  }
  configure(tools: ToolOptions) {
    if (!tools || typeof tools.web !== "boolean" || typeof tools.bash !== "boolean")
      throw new Error("无效的工具配置");
    if (this.state.messages.length || this.query) throw new Error("会话工具已锁定，请新建对话后更改");
    this.state.tools = { web: tools.web, bash: tools.bash };
    this.publish();
  }
  send(text: string, images: ImageInput[] = []) {
    if (!this.query && this.state.messages.length) throw new Error("会话已结束，请新建对话后再发送");
    if (this.state.busy) throw new Error("请等待回复完成，或先停止回复");
    validateImages(images);
    validateText(text, images.length);
    const bytes =
      Buffer.byteLength(text) +
      images.reduce((total, image) => total + image.data.length, 0) +
      this.state.messages.reduce(
        (total, message) =>
          total +
          Buffer.byteLength(message.text) +
          (message.calls ?? []).reduce((size, call) => size + Buffer.byteLength(call.input) + Buffer.byteLength(call.output ?? "") +
            (call.images ?? []).reduce((size, image) => size + image.data.length, 0), 0) +
          (message.images ?? []).reduce((size, image) => size + image.data.length, 0),
        0,
      );
    if (this.state.messages.length >= inputLimits.messages)
      throw new Error("消息已达 200 条，请新建对话");
    if (bytes > inputLimits.conversationBytes)
      throw new Error("会话内容超过 32 MiB，请新建对话");
    if (!this.query) {
      const input = new Inputs();
      const { web, bash } = this.state.tools;
      const customTools = web ? webTools(this.apiKey, this.options.zpi?.fetch) : [];
      const names = [...customTools.map((tool) => tool.name), ...(bash ? ["Bash", "Read"] : [])];
      this.query = query({ prompt: input, options: {
        ...this.options,
        cwd: this.state.cwd,
        tools: names,
        zpi: { ...this.options.zpi, customTools },
        // Keep commands in the foreground so Stop/Reset own their entire lifetime.
        canUseTool: async (name, value) => !names.includes(name)
          ? { behavior: "deny", message: "本会话未启用此工具" }
          : name === "Bash"
            ? { behavior: "allow", updatedInput: { ...value, run_in_background: false, timeout: value.timeout ?? 60000 } }
            : { behavior: "allow" },
      } });
      this.input = input;
      const generation = this.state.generation,
        response = this.query;
      this.loop = this.consume(response, generation);
    }
    const id = randomUUID();
    this.state.messages.push(
      { id, role: "user", text, images },
      { id: randomUUID(), role: "assistant", text: "", startedAt: Date.now() },
    );
    this.state.busy = true;
    this.state.error = undefined;
    this.publish();
    this.input!.push({
      type: "user",
      uuid: id,
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          { type: "text", text },
          ...images.map((image) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: image.mimeType, data: image.data },
          })),
        ],
      },
    });
  }
  private async consume(response: Query, generation: number) {
    let failure: unknown;
    try {
      for await (const message of response) {
        if (generation !== this.state.generation) break;
        this.receive(message);
      }
    } catch (error) {
      failure = error;
    } finally {
      response.close();
      if (generation === this.state.generation && this.query === response) {
        this.input?.close();
        this.input = undefined;
        this.query = undefined;
        this.state.busy = false;
        const assistant = this.state.messages.at(-1);
        if (assistant?.role === "assistant" && !assistant.status) {
          assistant.status = "error";
          assistant.endedAt = Date.now();
        }
        const reason =
          failure instanceof Error ? failure.message : failure === undefined ? "" : String(failure);
        this.state.error = assistant?.status === "interrupted" ? undefined :
          [reason || this.state.error, "会话已结束，请新建对话后再发送"].filter(Boolean).join("\n");
        this.publish();
      }
    }
  }
  private receive(message: SDKMessage) {
    const assistant = this.state.messages.at(-1);
    if (assistant?.role !== "assistant") return;
    if (message.type === "stream_event" && message.event.type === "message_start") {
      this.roundPrefix = assistant.text;
      this.hasRoundText = false;
      assistant.answerAt = Date.now();
    }
    if (
      message.type === "stream_event" &&
      message.event.type === "content_block_delta" &&
      message.event.delta.type === "text_delta"
    ) {
      const delta = (!this.hasRoundText && this.roundPrefix ? "\n\n" : "") + message.event.delta.text;
      assistant.text += delta;
      this.hasRoundText ||= Boolean(message.event.delta.text);
      this.notify({
        type: "text",
        generation: this.state.generation,
        id: assistant.id,
        delta,
      });
    } else if (message.type === "assistant") {
      const text = message.message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      assistant.text = [this.roundPrefix, text].filter(Boolean).join("\n\n");
      const calls = message.message.content.filter((block) => block.type === "tool_use");
      for (const call of calls) {
        assistant.calls ??= [];
        if (!assistant.calls.some((item) => item.id === call.id))
          assistant.calls.push({
            id: call.id, name: call.name,
            offset: assistant.text.length,
            input: String(call.input[call.name === "Bash" ? "command" : call.name === "Read" ? "file_path" : call.name === "web_search" ? "query" : "url"] ?? "").slice(0, 16000),
            ...(assistant.status === "interrupted" ? { interrupted: true, error: false, output: "已停止" } : {}),
          });
      }
      if (calls.length) this.publish();
    } else if (message.type === "user" && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type !== "tool_result") continue;
        const call = assistant.calls?.find((call) => call.id === block.tool_use_id);
        if (!call) continue;
        if (call.interrupted) continue;
        const output = typeof block.content === "string" ? block.content : block.content
          .filter((item) => item.type === "text").map((item) => item.text).join("\n");
        call.output = output.length > 16000 ? output.slice(0, 16000) + "\n[输出已截断]" : output;
        call.error = block.is_error;
        if (call.name === "Read" && !call.error && Array.isArray(block.content))
          call.images = block.content.flatMap((item) => item.type === "image" && item.source.type === "base64"
            ? [{ name: call.input, mimeType: item.source.media_type, data: item.source.data }]
            : []);
        if (!call.error) call.sources = webSources(call.name, output);
        this.publish();
      }
    } else if (message.type === "result") {
      this.state.busy = false;
      assistant.status ??= message.subtype === "success" ? "completed" : "error";
      assistant.endedAt = Date.now();
      for (const call of assistant.calls ?? []) {
        if (call.output === undefined) { call.output = "执行未完成"; call.error = true; }
      }
      if (message.subtype !== "success" && assistant.status !== "interrupted") this.state.error = message.errors.join("\n");
      this.publish();
    }
  }
  async stop() {
    const assistant = this.state.messages.at(-1);
    if (!this.state.busy || assistant?.role !== "assistant" || assistant.status === "interrupted") return;
    assistant.status = "interrupted";
    this.state.error = undefined;
    for (const call of assistant.calls ?? []) {
      if (call.output !== undefined) continue;
      call.interrupted = true;
      call.error = false;
      call.output = "已停止";
    }
    if (this.input?.cancelPending()) {
      this.state.busy = false;
      assistant.endedAt = Date.now();
      this.publish();
      return;
    }
    this.publish();
    await this.query?.interrupt();
  }
  async reset() {
    ++this.state.generation;
    this.input?.close();
    const response = this.query,
      loop = this.loop;
    this.query = undefined;
    this.input = undefined;
    this.loop = undefined;
    this.state.messages = [];
    this.state.busy = false;
    this.state.error = undefined;
    this.state.tools = { web: false, bash: false };
    this.roundPrefix = "";
    this.hasRoundText = false;
    // Publish in the shortcut callback stack. Old work is already isolated by generation.
    this.publish();
    response?.close();
    await loop;
  }
  async close() {
    await this.reset();
  }
}
