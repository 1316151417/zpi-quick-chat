import type { Bridge, ImageInput, Snapshot } from "./types.ts";
import { validateImageCount, validateImageFile, validateImages } from "./input.ts";
declare global {
  interface Window {
    quickChat: Bridge;
  }
}
const bridge = window.quickChat;
const copyIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>`;
const checkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>`;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = element<HTMLTextAreaElement>("input"),
  messages = element("messages"),
  error = element("error"),
  previews = element("images"),
  stop = element<HTMLButtonElement>("stop");
const textNodes = new Map<string, HTMLElement>();
let state: Snapshot = { generation: -1, messages: [], busy: false, model: "", reasoning: "" },
  images: ImageInput[] = [];
async function invoke(action: Parameters<Bridge["invoke"]>[0], value?: unknown) {
  const generation = state.generation;
  const result = await bridge.invoke(action, value);
  if (!result.ok && generation === state.generation) {
    error.textContent = result.error;
    error.hidden = false;
  }
  return result.ok;
}
function renderImages() {
  previews.replaceChildren();
  images.forEach((image, index) => {
    const box = document.createElement("div"),
      img = document.createElement("img"),
      remove = document.createElement("button");
    img.src = `data:${image.mimeType};base64,${image.data}`;
    img.alt = image.name;
    remove.textContent = "×";
    remove.title = "移除图片";
    remove.onclick = () => {
      images.splice(index, 1);
      renderImages();
    };
    box.append(img, remove);
    previews.append(box);
  });
}
async function addFiles(files: File[]) {
  const generation = state.generation;
  try {
    validateImageCount(images.length + files.length);
  } catch (failure) {
    error.textContent = failure instanceof Error ? failure.message : String(failure);
    error.hidden = false;
    return;
  }
  for (const file of files) {
    if (generation !== state.generation) return;
    try {
      validateImageFile(file);
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("读取图片失败，请重试"));
        reader.onabort = () => reject(new Error("图片读取已取消"));
        reader.readAsDataURL(file);
      });
      if (generation !== state.generation) return;
      validateImageCount(images.length + 1);
      const image = { name: file.name, mimeType: file.type, data };
      validateImages([image]);
      images.push(image);
    } catch (failure) {
      if (generation !== state.generation) return;
      error.textContent = failure instanceof Error ? failure.message : String(failure);
      error.hidden = false;
    }
  }
  if (generation === state.generation) renderImages();
}
bridge.onSnapshot((snapshot) => {
  if (snapshot.generation !== state.generation) {
    input.value = "";
    images = [];
    renderImages();
  }
  const scroll = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 100;
  state = snapshot;
  messages.replaceChildren();
  textNodes.clear();
  for (const message of snapshot.messages) {
    const article = document.createElement("article");
    article.className = `message ${message.role}`;
    if (message.images?.length) {
      const gallery = document.createElement("div");
      gallery.className = "message-images";
      for (const image of message.images) {
        const img = document.createElement("img");
        img.src = `data:${image.mimeType};base64,${image.data}`;
        img.alt = image.name;
        gallery.append(img);
      }
      article.append(gallery);
    }
    const text = document.createElement("div");
    textNodes.set(message.id, text);
    text.textContent = message.text || (snapshot.busy && message.role === "assistant" ? "…" : "");
    article.append(text);
    if (message.role === "assistant" && message.text) {
      const copy = document.createElement("button");
      let timer = 0;
      copy.className = "copy";
      copy.type = "button";
      copy.title = "复制";
      copy.setAttribute("aria-label", "复制");
      copy.innerHTML = copyIcon;
      copy.onclick = async () => {
        if (!(await invoke("copy", message.text))) return;
        copy.innerHTML = checkIcon;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => (copy.innerHTML = copyIcon), 1200);
      };
      article.append(copy);
    }
    messages.append(article);
  }
  error.textContent = snapshot.error ?? "";
  error.hidden = !snapshot.error;
  stop.hidden = !snapshot.busy;
  if (scroll) messages.scrollTop = messages.scrollHeight;
  void invoke("resize", snapshot.messages.length ? 620 : 300);
});
bridge.onText((update) => {
  if (update.generation !== state.generation) return;
  const node = textNodes.get(update.id),
    message = state.messages.find((message) => message.id === update.id);
  if (!node || !message) return;
  const scroll = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 100;
  message.text += update.delta;
  node.textContent = message.text;
  if (scroll) messages.scrollTop = messages.scrollHeight;
});
bridge.onDraft((draft) => {
  if (draft.error) {
    error.textContent = draft.error;
    error.hidden = false;
  }
  if (draft.text) input.value += `${input.value ? "\n" : ""}${draft.text}`;
  if (draft.image)
    void addFiles([
      new File([new Uint8Array(draft.image.bytes)], draft.image.name, { type: "image/png" }),
    ]);
  input.focus();
});
element("composer").onsubmit = async (event) => {
  event.preventDefault();
  const text = input.value,
    generation = state.generation,
    pending = [...images];
  if (state.busy || (!text.trim() && !pending.length)) return;
  if ((await invoke("send", { text, images: pending, generation })) && generation === state.generation) {
    if (input.value === text) input.value = "";
    images = images.filter((image) => !pending.includes(image));
    renderImages();
    input.focus();
  }
};
input.onkeydown = (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    element<HTMLFormElement>("composer").requestSubmit();
  }
};
input.onpaste = (event) => {
  const files = [...(event.clipboardData?.files ?? [])];
  if (files.length) {
    event.preventDefault();
    void addFiles(files);
  }
};
element("new").onclick = () => {
  void invoke("reset");
  input.focus();
};
stop.onclick = () => {
  void invoke("stop");
};
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") void invoke("hide");
});
window.addEventListener("focus", () => input.focus());
void invoke("snapshot");
