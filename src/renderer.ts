import type { Bridge, ImageInput, Snapshot } from "./types.ts";
import { inputLimits, validateImageCount, validateImageFile, validateImages } from "./input.ts";
declare global {
  interface Window {
    quickChat: Bridge;
  }
}
const bridge = window.quickChat;
const copyIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/></svg>`;
const checkIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m20 6-11 11-5-5"/></svg>`;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = element<HTMLTextAreaElement>("input"),
  composer = element<HTMLFormElement>("composer"),
  messages = element("messages"),
  error = element("error"),
  previews = element("images"),
  stop = element<HTMLButtonElement>("stop"),
  send = element<HTMLButtonElement>("send"),
  pin = element<HTMLButtonElement>("pin"),
  viewer = element<HTMLDialogElement>("image-preview");
const textNodes = new Map<string, HTMLElement>();
const deltas = new Map<string, string>();
let state: Snapshot = { generation: -1, messages: [], busy: false, model: "", reasoning: "" },
  images: ImageInput[] = [],
  sending: number | undefined,
  reading = 0,
  composing = false,
  frame = 0;
function showError(value: unknown) {
  error.textContent = value instanceof Error ? value.message : String(value);
  error.hidden = !error.textContent;
}
async function invoke(action: Parameters<Bridge["invoke"]>[0], value?: unknown) {
  const generation = state.generation;
  try {
    const result = await bridge.invoke(action, value);
    if (!result.ok && generation === state.generation) showError(result.error);
    return result.ok;
  } catch (failure) {
    if (generation === state.generation) showError(failure);
    return false;
  }
}
function updateComposer() {
  stop.hidden = !state.busy;
  send.hidden = state.busy;
  send.disabled = sending === state.generation || reading > 0 || (!input.value.trim() && !images.length);
  reportLayout();
}
function imageButton(image: ImageInput) {
  const button = document.createElement("button"),
    img = document.createElement("img");
  button.type = "button";
  button.className = "image-preview";
  button.setAttribute("aria-label", `预览 ${image.name}`);
  img.src = `data:${image.mimeType};base64,${image.data}`;
  img.alt = image.name;
  button.append(img);
  button.onclick = () => {
    const preview = viewer.querySelector("img")!;
    preview.src = img.src;
    preview.alt = image.name;
    viewer.showModal();
  };
  return button;
}
function renderImages() {
  previews.replaceChildren();
  images.forEach((image, index) => {
    const box = document.createElement("div"),
      remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "移除图片";
    remove.onclick = () => {
      images.splice(index, 1);
      renderImages();
      input.focus();
    };
    box.append(imageButton(image), remove);
    previews.append(box);
  });
  updateComposer();
}
async function addFiles(files: File[]) {
  const generation = state.generation;
  try {
    validateImageCount(images.length + files.length);
  } catch (failure) {
    showError(failure);
    return;
  }
  reading++;
  updateComposer();
  try {
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
        showError(failure);
      }
    }
  } finally {
    if (generation === state.generation) {
      reading--;
      renderImages();
    }
  }
}
const atBottom = () => messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
bridge.onSnapshot((snapshot) => {
  if (snapshot.generation < state.generation) return;
  const changed = snapshot.generation !== state.generation,
    scroll = changed || atBottom();
  if (changed) {
    viewer.close();
    input.value = "";
    images = [];
    reading = 0;
    sending = undefined;
    textNodes.clear();
    messages.replaceChildren();
  }
  deltas.clear();
  state = snapshot;
  document.body.classList.toggle("expanded", snapshot.expanded ?? snapshot.messages.length > 0);
  pin.setAttribute("aria-pressed", String(Boolean(snapshot.pinned)));
  pin.title = snapshot.pinned ? "已固定，点击后失焦隐藏" : "失焦隐藏，点击固定窗口";
  for (const message of snapshot.messages) {
    let text = textNodes.get(message.id);
    if (!text) {
      const article = document.createElement("article");
      article.className = `message ${message.role}`;
      if (message.images?.length) {
        const gallery = document.createElement("div");
        gallery.className = "message-images";
        for (const image of message.images) {
          gallery.append(imageButton(image));
        }
        article.append(gallery);
      }
      text = document.createElement("div");
      text.className = "message-text";
      textNodes.set(message.id, text);
      article.append(text);
      if (message.role === "assistant") {
        const copy = document.createElement("button");
        copy.className = "copy";
        copy.type = "button";
        copy.title = "复制";
        copy.setAttribute("aria-label", "复制");
        copy.innerHTML = copyIcon;
        copy.onclick = async () => {
          const value = state.messages.find((item) => item.id === message.id)?.text;
          if (!value || !(await invoke("copy", value))) return;
          copy.innerHTML = checkIcon;
          window.setTimeout(() => (copy.innerHTML = copyIcon), 1200);
        };
        article.append(copy);
      }
      messages.append(article);
    }
    const value = message.text || (snapshot.busy && message.role === "assistant" ? "…" : "");
    if (text.textContent !== value) text.textContent = value;
    const copy = text.nextElementSibling as HTMLButtonElement | null;
    if (copy) copy.hidden = !message.text;
  }
  showError(snapshot.error ?? "");
  if (changed) renderImages();
  updateComposer();
  if (scroll) messages.scrollTop = messages.scrollHeight;
  if (changed) input.focus();
});
bridge.onText((update) => {
  if (update.generation !== state.generation) return;
  const message = state.messages.find((message) => message.id === update.id);
  if (!message) return;
  if (!message.text) textNodes.get(update.id)?.replaceChildren(document.createTextNode(""));
  message.text += update.delta;
  deltas.set(update.id, (deltas.get(update.id) ?? "") + update.delta);
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (!deltas.size) return;
    const scroll = atBottom();
    for (const [id, delta] of deltas) {
      const node = textNodes.get(id);
      (node?.firstChild as Text | undefined)?.appendData(delta);
      if (node?.nextElementSibling) (node.nextElementSibling as HTMLElement).hidden = false;
    }
    deltas.clear();
    if (scroll) messages.scrollTop = messages.scrollHeight;
  });
});
bridge.onDraft((draft) => {
  if (draft.error) showError(draft.error);
  if (draft.text) {
    const next = input.value + `${input.value ? "\n" : ""}${draft.text}`;
    if (next.length > inputLimits.textCharacters) showError("带入后文字超过 32000 字，请缩短内容");
    else input.value = next;
  }
  if (draft.image)
    void addFiles([
      new File([new Uint8Array(draft.image.bytes)], draft.image.name, { type: "image/png" }),
    ]);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  input.scrollTop = input.scrollHeight;
  updateComposer();
});
composer.onsubmit = async (event) => {
  event.preventDefault();
  const text = input.value,
    generation = state.generation,
    pending = [...images];
  if (state.busy || sending === generation || reading || (!text.trim() && !pending.length)) return;
  sending = generation;
  updateComposer();
  const accepted = await invoke("send", { text, images: pending, generation });
  if (generation !== state.generation) return;
  sending = undefined;
  if (accepted) {
    if (input.value === text) input.value = "";
    images = images.filter((image) => !pending.includes(image));
    renderImages();
    input.focus();
  }
  updateComposer();
};
input.oninput = updateComposer;
input.addEventListener("compositionstart", () => (composing = true));
input.addEventListener("compositionend", () => (composing = false));
input.onkeydown = (event) => {
  if (event.defaultPrevented || event.isComposing || composing || event.keyCode === 229) return;
  if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    if (!event.repeat) composer.requestSubmit();
  }
};
input.onpaste = (event) => {
  const files = [...(event.clipboardData?.files ?? [])];
  if (!files.length) return;
  event.preventDefault();
  const text = event.clipboardData?.getData("text/plain");
  if (text) {
    if (input.value.length - (input.selectionEnd - input.selectionStart) + text.length > inputLimits.textCharacters)
      showError("粘贴后文字超过 32000 字，请缩短内容");
    else input.setRangeText(text, input.selectionStart, input.selectionEnd, "end");
  }
  void addFiles(files);
};
element("new").onclick = () => void invoke("reset");
stop.onclick = () => void invoke("stop");
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !viewer.open && !event.defaultPrevented && !event.repeat && !event.isComposing && !composing && event.keyCode !== 229) {
    event.preventDefault();
    void invoke("hide");
  }
});
window.addEventListener("focus", () => {
  if (!viewer.open) input.focus();
});
viewer.onclick = (event) => {
  if (event.target === viewer || event.target === viewer.querySelector("button")) viewer.close();
};
viewer.onclose = () => {
  viewer.querySelector("img")!.removeAttribute("src");
  input.focus();
};
pin.onclick = () => {
  void invoke("pin", { generation: state.generation, pinned: !state.pinned });
  input.focus();
};
let reportedLayout = "";
function reportLayout() {
  if (state.generation < 0) return;
  const layout = {
    generation: state.generation,
    height: composer.offsetHeight,
    occupied: Boolean(input.value || images.length || reading),
  };
  const key = JSON.stringify(layout);
  if (key === reportedLayout) return;
  reportedLayout = key;
  void invoke("resize", layout);
}
const contentObserver = new ResizeObserver(reportLayout);
contentObserver.observe(composer);
contentObserver.observe(error);
void invoke("snapshot");
