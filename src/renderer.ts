import type { Bridge, ChatMessage, ImageInput, Snapshot, ToolCall, WebSource } from "./types.ts";
import { inputLimits, validateImageCount, validateImageFile, validateImages } from "./input.ts";
import { answerText, markdown } from "./markdown.ts";
declare global {
  interface Window {
    quickChat: Bridge;
  }
}
const bridge = window.quickChat;
const icon = (body: string, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const copyIcon = icon('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>', 14);
const checkIcon = icon('<path d="m20 6-11 11-5-5"/>', 14);
const searchIcon = icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>');
const fileIcon = icon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>');
const loaderIcon = icon('<path d="M12 2v4m4.2 1.8 2.9-2.9M18 12h4m-5.8 4.2 2.9 2.9M12 18v4M4.9 19.1l2.9-2.9M2 12h4M4.9 4.9l2.9 2.9"/>');
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = element<HTMLTextAreaElement>("input"),
  composer = element<HTMLFormElement>("composer"),
  messages = element("messages"),
  error = element("error"),
  previews = element("images"),
  stop = element<HTMLButtonElement>("stop"),
  send = element<HTMLButtonElement>("send"),
  pin = element<HTMLButtonElement>("pin"),
  toolOptions = element("tool-options"),
  web = element<HTMLButtonElement>("web"),
  bash = element<HTMLButtonElement>("bash"),
  viewer = element<HTMLDialogElement>("image-preview"),
  sourcesPopover = element("answer-sources");
const globeIcon = web.innerHTML, terminalIcon = bash.innerHTML;
const timeFormat = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const yearDateFormat = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const textNodes = new Map<string, HTMLElement>();
const deltas = new Set<string>();
const rendered = new WeakMap<HTMLElement, string>();
let following = true, canResume = true, lastScrollTop = 0, sourceTrigger: HTMLButtonElement | undefined,
  workTimer: ReturnType<typeof setInterval> | undefined;
let state: Snapshot = { generation: -1, messages: [], busy: false, model: "", reasoning: "", tools: { web: false, bash: false }, cwd: "" },
  images: ImageInput[] = [],
  sending: number | undefined,
  reading = 0,
  composing = false,
  frame = 0,
  configuring: Promise<boolean> | undefined;
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
  web.disabled = bash.disabled = configuring !== undefined || sending === state.generation;
  reportLayout();
}
function setText(node: Element, value: string) {
  if (node.textContent !== value) node.textContent = value;
}
// Retain unchanged Markdown nodes and selection anchors while only the tail streams.
function patchChildren(parent: Node, next: Node) {
  const children = [...next.childNodes];
  children.forEach((child, index) => {
    const current = parent.childNodes[index];
    if (!current) { parent.appendChild(child); return; }
    if (current.isEqualNode(child)) return;
    if (current.nodeType !== child.nodeType || current.nodeName !== child.nodeName) { current.replaceWith(child); return; }
    if (current instanceof Text && child instanceof Text) {
      if (child.data.startsWith(current.data)) current.appendData(child.data.slice(current.length));
      else {
        let start = 0;
        while (start < current.length && current.data[start] === child.data[start]) start++;
        current.replaceData(start, current.length - start, child.data.slice(start));
      }
    } else if (current instanceof Element && child instanceof Element) {
      for (const attr of [...current.attributes]) if (!child.hasAttribute(attr.name)) current.removeAttribute(attr.name);
      for (const attr of [...child.attributes]) if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
      patchChildren(current, child);
    }
  });
  while (parent.childNodes.length > children.length) parent.removeChild(parent.lastChild!);
}
function renderMarkdown(node: HTMLElement, value: string) {
  if (rendered.get(node) === value) return;
  const template = document.createElement("template");
  template.innerHTML = markdown(value);
  patchChildren(node, template.content);
  rendered.set(node, value);
}
function renderCall(node: HTMLElement, call: ToolCall) {
  const terminal = call.name === "Bash", file = call.name === "Read", search = call.name === "web_search", running = call.output === undefined;
  if (!node.childElementCount) {
    node.className = "tool-call";
    const summary = document.createElement(terminal ? "summary" : "div");
    summary.className = "tool-summary-row";
    summary.innerHTML = `${terminal ? terminalIcon : file ? fileIcon : search ? searchIcon : globeIcon}<strong></strong><span class="tool-summary-text"></span><span class="tool-summary-status"></span>${terminal ? icon('<path d="m9 18 6-6-6-6"/>') : ""}`;
    node.append(summary);
    if (terminal) {
      const command = document.createElement("pre"), output = document.createElement("pre");
      command.className = "tool-command";
      output.className = "tool-output";
      node.append(command, output);
    } else {
      const failure = document.createElement("p");
      failure.className = "tool-error";
      node.append(failure);
      if (file) {
        const gallery = document.createElement("div");
        gallery.className = "message-images tool-images";
        node.append(gallery);
      }
    }
  }
  const primary = search ? `查找 ${call.input}` : call.input;
  node.dataset.running = String(running);
  const summary = node.firstElementChild!;
  setText(summary.querySelector("strong")!, terminal ? running ? "正在执行" : "终端" : search ? running ? "正在搜索" : "联网搜索" : running ? "正在读取" : file ? "读取文件" : "读取网页");
  setText(summary.querySelector(".tool-summary-text")!, primary);
  summary.setAttribute("title", primary);
  setText(summary.querySelector(".tool-summary-status")!, running ? "" : call.error ? "未完成" : search ? `${call.sources?.length ?? 0} 个来源` : terminal ? "" : "已完成");
  if (terminal) {
    setText(node.querySelector(".tool-command")!, `$ ${call.input}`);
    setText(node.querySelector(".tool-output")!, call.output ?? "执行中…");
  } else {
    const failure = node.querySelector<HTMLElement>(".tool-error")!;
    setText(failure, call.error ? call.output ?? "工具执行失败" : "");
    failure.hidden = !call.error;
    if (file) {
      const gallery = node.querySelector<HTMLElement>(".tool-images")!;
      if (!gallery.childElementCount && call.images?.length) gallery.append(...call.images.map(imageButton));
      gallery.hidden = !call.images?.length;
    }
  }
}
function answerSources(message: ChatMessage): WebSource[] {
  const sources = new Map<string, WebSource>();
  for (const call of message.calls ?? []) {
    if (call.offset >= message.text.length) continue;
    for (const source of call.sources ?? []) if (!sources.has(source.url)) sources.set(source.url, source);
  }
  return [...sources.values()];
}
function progressLabel(message: ChatMessage) {
  const seconds = Math.max(1, Math.round(((message.endedAt ?? Date.now()) - (message.startedAt ?? Date.now())) / 1000));
  const duration = [[Math.floor(seconds / 86400), "天"], [Math.floor(seconds % 86400 / 3600), "时"], [Math.floor(seconds % 3600 / 60), "分"], [seconds % 60, "秒"]]
    .filter(([value]) => value).slice(0, 2).map(([value, unit]) => `${value} ${unit}`).join(" ");
  return `${message.status === "completed" ? "已工作" : message.status === "interrupted" ? "已停止" : message.status === "error" ? "运行失败" : "工作中"} ${duration}`;
}
function messageTime(timestamp: number) {
  const date = new Date(timestamp), now = new Date(), yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const time = timeFormat.format(date);
  if (date.toDateString() === now.toDateString()) return time;
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
  return (date.getFullYear() === now.getFullYear() ? dateFormat : yearDateFormat).format(date);
}
function renderMessage(node: HTMLElement, message: ChatMessage, sources: WebSource[]) {
  if (message.role === "user") {
    node.hidden = !message.text;
    if (!node.firstElementChild) {
      const body = document.createElement("div"), clip = document.createElement("div"), content = document.createElement("div"), toggle = document.createElement("button");
      body.className = "user-message-body";
      body.dataset.expanded = "false";
      clip.className = "user-message-content";
      content.className = "user-message-content-inner";
      toggle.className = "user-message-toggle";
      toggle.type = "button";
      toggle.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "展开消息");
      toggle.innerHTML = icon('<path d="m6 9 6 6 6-6"/>');
      toggle.onclick = () => {
        const expanded = body.dataset.expanded !== "true";
        body.dataset.expanded = String(expanded);
        toggle.setAttribute("aria-expanded", String(expanded));
        toggle.setAttribute("aria-label", expanded ? "收起消息" : "展开消息");
        clip.style.maxHeight = expanded ? `${content.scrollHeight}px` : "120px";
      };
      clip.append(content);
      body.append(clip, toggle);
      node.append(body);
      contentObserver.observe(content);
    }
    setText(node.querySelector(".user-message-content-inner")!, message.text);
    return;
  }
  const calls = message.calls ?? [], lastOffset = calls.at(-1)?.offset ?? 0;
  const complete = message.status === "completed" && Boolean(message.text.slice(lastOffset).trim());
  let body: HTMLElement;
  {
    let process = node.querySelector<HTMLDetailsElement>(":scope > .process");
    if (!process) {
      process = document.createElement("details");
      process.className = "process";
      const summary = document.createElement("summary");
      summary.innerHTML = `<span></span>${icon('<path d="m9 18 6-6-6-6"/>')}`;
      body = document.createElement("div");
      body.className = "process-body";
      body.append(...node.childNodes);
      process.append(summary, body);
      node.append(process);
      summary.onclick = (event) => { if (process!.dataset.complete !== "true" || process!.dataset.expandable !== "true") event.preventDefault(); };
    } else body = process.querySelector<HTMLElement>(".process-body")!;
    if (process.dataset.complete !== String(complete)) process.open = !complete;
    process.dataset.complete = String(complete);
    process.dataset.expandable = String(calls.length > 0);
    setText(process.querySelector("summary span")!, progressLabel(message));
  }
  const existing = new Map([...body.children].map((child) => [(child as HTMLElement).dataset.key, child as HTMLElement]));
  let index = 0, cursor = 0;
  const part = (key: string, tag = "div") => {
    const child = existing.get(key) ?? document.createElement(tag);
    child.dataset.key = key;
    if (body.children[index] !== child) body.insertBefore(child, body.children[index] ?? null);
    index++;
    return child;
  };
  const prose = (end: number) => {
    if (end <= cursor) return;
    const block = part(`text:${cursor}`);
    block.className = "markdown-body";
    renderMarkdown(block, answerText(message.text.slice(cursor, end), sources));
    cursor = end;
  };
  for (const call of calls) {
    prose(call.offset);
    renderCall(part(`call:${call.id}`, call.name === "Bash" ? "details" : "div"), call);
  }
  if (complete) {
    const key = `text:${cursor}`, answer = existing.get(key) ?? node.querySelector<HTMLElement>(":scope > .answer") ?? document.createElement("div");
    answer.dataset.key = key;
    answer.className = "markdown-body answer";
    if (answer.parentElement !== node) node.append(answer);
    renderMarkdown(answer, answerText(message.text.slice(cursor), sources));
  } else prose(message.text.length);
  while (body.children.length > index) body.lastElementChild!.remove();
  let loading = node.querySelector<HTMLElement>(":scope > .chat-loading-slot");
  if (!message.status) {
    if (!loading) {
      loading = document.createElement("div");
      loading.className = "chat-loading-slot";
      loading.setAttribute("role", "status");
      loading.setAttribute("aria-label", "加载中");
      loading.innerHTML = loaderIcon;
      node.append(loading);
    }
  } else loading?.remove();
}

function placeSources() {
  if (!sourceTrigger || !sourcesPopover.matches(":popover-open")) return;
  const anchor = sourceTrigger.getBoundingClientRect(), height = sourcesPopover.offsetHeight,
    top = anchor.top - height - 8;
  sourcesPopover.style.left = `${Math.max(12, Math.min(anchor.right - sourcesPopover.offsetWidth, innerWidth - sourcesPopover.offsetWidth - 12))}px`;
  sourcesPopover.style.top = `${Math.max(12, Math.min(top >= 12 ? top : anchor.bottom + 8, innerHeight - height - 12))}px`;
}
function showSources(trigger: HTMLButtonElement, sources: WebSource[]) {
  if (sourceTrigger === trigger && sourcesPopover.matches(":popover-open")) { sourcesPopover.hidePopover(); return; }
  sourcesPopover.hidePopover();
  sourceTrigger?.setAttribute("aria-expanded", "false");
  sourceTrigger = trigger;
  setText(element("sources-count"), String(sources.length));
  const list = element("sources-list");
  list.replaceChildren();
  for (const source of sources) {
    const item = document.createElement("li"), button = document.createElement("button"), site = document.createElement("span");
    button.type = "button";
    button.className = "answer-source-link";
    button.title = source.url;
    site.className = "answer-source-site";
    site.innerHTML = globeIcon;
    const name = document.createElement("span");
    name.textContent = source.siteName;
    site.append(name);
    button.append(site);
    for (const [value, className] of [[source.title, "title"], [source.date, "date"], [source.excerpt, "excerpt"]]) {
      if (!value) continue;
      const span = document.createElement("span");
      span.className = `answer-source-${className}`;
      span.textContent = value;
      button.append(span);
    }
    button.onclick = () => { void invoke("open-url", source.url); sourcesPopover.hidePopover(); };
    item.append(button);
    list.append(item);
  }
  sourcesPopover.showPopover();
  trigger.setAttribute("aria-expanded", "true");
  placeSources();
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
    if (viewer.open) return;
    const preview = viewer.querySelector("img")!;
    preview.src = img.src;
    preview.alt = image.name;
    viewer.dataset.generation = String(state.generation);
    viewer.showModal();
    void invoke("preview", { generation: state.generation, open: true });
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
const atBottom = () => messages.scrollHeight - messages.scrollTop - messages.clientHeight <= 2;
function followOutput() {
  if (following) messages.scrollTop = messages.scrollHeight;
  lastScrollTop = messages.scrollTop;
}
messages.addEventListener("wheel", (event) => {
  if (event.deltaY < 0) following = canResume = false;
  else if (event.deltaY > 0) { canResume = true; if (atBottom()) following = true; }
}, { passive: true });
messages.addEventListener("keydown", (event) => {
  if (["ArrowUp", "PageUp", "Home"].includes(event.key)) following = canResume = false;
  else if (event.key === "End" || event.metaKey && event.key === "ArrowDown") {
    event.preventDefault();
    following = canResume = true;
    followOutput();
  } else if (["ArrowDown", "PageDown", " "].includes(event.key)) canResume = true;
});
messages.addEventListener("pointerdown", () => { following = false; canResume = true; });
messages.addEventListener("scroll", () => {
  if (messages.scrollTop !== lastScrollTop) following = canResume && atBottom();
  lastScrollTop = messages.scrollTop;
  placeSources();
}, { passive: true });
bridge.onSnapshot((snapshot) => {
  if (snapshot.generation < state.generation) return;
  const changed = snapshot.generation !== state.generation;
  if (changed) {
    viewer.close();
    sourcesPopover.hidePopover();
    sourceTrigger = undefined;
    following = canResume = true;
    input.value = "";
    images = [];
    reading = 0;
    sending = undefined;
    configuring = undefined;
    textNodes.clear();
    contentObserver.disconnect();
    contentObserver.observe(composer);
    contentObserver.observe(error);
    messages.replaceChildren();
  }
  deltas.clear();
  state = snapshot;
  toolOptions.hidden = snapshot.messages.length > 0;
  web.setAttribute("aria-pressed", String(snapshot.tools.web));
  bash.setAttribute("aria-pressed", String(snapshot.tools.bash));
  web.title = `${snapshot.tools.web ? "关闭" : "启用"}联网搜索`;
  bash.title = `${snapshot.tools.bash ? "关闭" : "启用"}本机工具（查找文件、读取文字和图片、执行命令）\n工作目录：${snapshot.cwd}`;
  document.querySelector("header")!.title = [snapshot.tools.web ? "联网搜索已启用" : "联网搜索已关闭", snapshot.tools.bash ? `本机工具已启用\n工作目录：${snapshot.cwd}` : "本机工具已关闭"].join(" · ");
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
      {
        const id = message.id;
        const actions = document.createElement("div");
        actions.className = "message-actions";
        const copy = document.createElement("button");
        copy.className = "copy";
        copy.type = "button";
        copy.title = "复制";
        copy.setAttribute("aria-label", "复制");
        copy.innerHTML = copyIcon;
        copy.onclick = async () => {
          const current = state.messages.find((item) => item.id === id);
          const answer = current?.role === "user" ? current.text : current?.text.slice(current.calls?.at(-1)?.offset ?? 0).trim();
          if (!current || !answer || !(await invoke("copy", answerText(answer, answerSources(current))))) return;
          copy.innerHTML = checkIcon;
          window.setTimeout(() => (copy.innerHTML = copyIcon), 1200);
        };
        actions.append(copy);
        if (message.role === "assistant") {
          const sources = document.createElement("button");
          sources.type = "button";
          sources.className = "answer-sources-trigger";
          sources.setAttribute("aria-expanded", "false");
          sources.setAttribute("aria-controls", "answer-sources");
          sources.innerHTML = `${globeIcon}<span>来源</span>`;
          sources.onclick = () => {
            const current = state.messages.find((item) => item.id === id);
            if (current) showSources(sources, answerSources(current));
          };
          const time = document.createElement("time");
          time.className = "message-time";
          actions.append(sources, time);
        }
        article.append(actions);
      }
      messages.append(article);
    }
    const sources = message.role === "assistant" ? answerSources(message) : [];
    renderMessage(text, message, sources);
    const actions = text.nextElementSibling as HTMLElement | null;
    if (actions) {
      actions.hidden = !message.text || message.role === "assistant" && message.status !== "completed";
      const trigger = actions.querySelector<HTMLButtonElement>(".answer-sources-trigger");
      if (trigger) {
        trigger.hidden = !sources.length;
        trigger.setAttribute("aria-label", `来源，${sources.length} 个网页`);
      }
      const time = actions.querySelector("time"), timestamp = message.answerAt ?? message.startedAt;
      if (time && timestamp) {
        const date = new Date(timestamp);
        time.dateTime = date.toISOString();
        time.title = date.toLocaleString("zh-CN");
        setText(time, messageTime(timestamp));
      }
    }
  }
  showError(snapshot.error ?? "");
  if (changed) renderImages();
  updateComposer();
  if (snapshot.busy && !workTimer) workTimer = setInterval(() => {
    const message = state.messages.at(-1), summary = message && textNodes.get(message.id)?.querySelector(".process > summary span");
    if (message && summary) setText(summary, progressLabel(message));
  }, 1000);
  else if (!snapshot.busy && workTimer) { clearInterval(workTimer); workTimer = undefined; }
  followOutput();
  if (changed) input.focus();
});
bridge.onText((update) => {
  if (update.generation !== state.generation) return;
  const message = state.messages.find((message) => message.id === update.id);
  if (!message) return;
  message.text += update.delta;
  deltas.add(update.id);
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (!deltas.size) return;
    for (const id of deltas) {
      const node = textNodes.get(id), message = state.messages.find((item) => item.id === id);
      if (node && message) renderMessage(node, message, answerSources(message));
      if (node?.nextElementSibling) (node.nextElementSibling as HTMLElement).hidden = message?.status !== "completed";
    }
    deltas.clear();
    followOutput();
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
  const requestedGeneration = state.generation;
  if (configuring) await configuring;
  if (requestedGeneration !== state.generation) return;
  const text = input.value,
    generation = state.generation,
    pending = [...images];
  if (state.busy || sending === generation || reading || (!text.trim() && !pending.length)) return;
  following = canResume = true;
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
for (const [name, button] of [["web", web], ["bash", bash]] as const) {
  button.onclick = async () => {
    if (configuring || state.messages.length || sending === state.generation) return;
    const operation = invoke("tools", { generation: state.generation, tools: { ...state.tools, [name]: !state.tools[name] } });
    configuring = operation;
    updateComposer();
    await operation;
    if (configuring === operation) configuring = undefined;
    updateComposer();
    input.focus();
  };
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !viewer.open && !event.defaultPrevented && !event.repeat && !event.isComposing && !composing && event.keyCode !== 229) {
    event.preventDefault();
    if (sourcesPopover.matches(":popover-open")) { sourcesPopover.hidePopover(); sourceTrigger?.focus(); return; }
    void invoke("hide");
  }
});
window.addEventListener("focus", () => {
  if (!viewer.open && !sourcesPopover.matches(":popover-open")) input.focus();
});
window.addEventListener("resize", () => { followOutput(); placeSources(); });
element("close-sources").onclick = () => { sourcesPopover.hidePopover(); sourceTrigger?.focus(); };
sourcesPopover.addEventListener("toggle", () => {
  sourceTrigger?.setAttribute("aria-expanded", String(sourcesPopover.matches(":popover-open")));
});
messages.addEventListener("click", async (event) => {
  const target = event.target as Element, link = target.closest<HTMLAnchorElement>("a");
  if (link) { event.preventDefault(); void invoke("open-url", link.href); }
  const copy = target.closest<HTMLButtonElement>(".copy-code");
  if (copy) {
    const text = copy.closest(".code-block")?.querySelector("code")?.textContent;
    if (text && await invoke("copy", text)) {
      copy.textContent = "已复制";
      window.setTimeout(() => (copy.textContent = "复制"), 1200);
    }
  }
});
viewer.onclick = (event) => {
  if (event.target === viewer || event.target === viewer.querySelector("button")) viewer.close();
};
viewer.onclose = () => {
  if (viewer.open) return;
  viewer.querySelector("img")!.removeAttribute("src");
  const generation = Number(viewer.dataset.generation);
  if (generation !== state.generation) return;
  void invoke("preview", { generation, open: false });
  input.focus();
};
pin.onclick = () => {
  void invoke("pin", { generation: state.generation, pinned: !state.pinned });
  input.focus();
};
let reportedLayout = "";
function reportLayout() {
  if (state.generation < 0 || viewer.open) return;
  const layout = {
    generation: state.generation,
    height: composer.offsetHeight,
    occupied: Boolean(input.value || images.length || reading),
  };
  const key = JSON.stringify(layout);
  if (key === reportedLayout) return;
  reportedLayout = key;
  void invoke("resize", layout);
  followOutput();
}
const contentObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    if (!entry.target.classList.contains("user-message-content-inner")) continue;
    const body = entry.target.closest<HTMLElement>(".user-message-body")!, toggle = body.querySelector<HTMLButtonElement>("button")!;
    const height = Math.ceil(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height);
    body.dataset.expandable = String(height > 121);
    toggle.hidden = height <= 121;
    body.querySelector<HTMLElement>(".user-message-content")!.style.maxHeight = body.dataset.expanded === "true" ? `${height}px` : "120px";
  }
  reportLayout();
});
contentObserver.observe(composer);
contentObserver.observe(error);
void invoke("snapshot");
