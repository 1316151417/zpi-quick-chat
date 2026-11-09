export interface QuickChatDraftInput {
  text?: string;
  image?: { name: string; bytes: Uint8Array };
  error?: string;
}
export interface ImageInput {
  name: string;
  data: string;
  mimeType: string;
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  images?: ImageInput[];
}
export interface Snapshot {
  expanded?: boolean;
  pinned?: boolean;
  generation: number;
  messages: ChatMessage[];
  busy: boolean;
  error?: string;
  model: string;
  reasoning: string;
}
export interface TextUpdate {
  generation: number;
  id: string;
  delta: string;
}
export type ChatUpdate = Snapshot | ({ type: "text" } & TextUpdate);
export type Action = "send" | "stop" | "reset" | "hide" | "quit" | "snapshot" | "resize" | "copy" | "pin";
export type Reply = { ok: true } | { ok: false; error: string };
export interface Bridge {
  invoke(action: Action, input?: unknown): Promise<Reply>;
  onSnapshot(callback: (snapshot: Snapshot) => void): () => void;
  onText(callback: (update: TextUpdate) => void): () => void;
  onDraft(callback: (draft: QuickChatDraftInput) => void): () => void;
}
