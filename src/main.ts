import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  systemPreferences,
} from "electron";
import { dirname, isAbsolute, join } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Chat } from "./chat.ts";
import { readConfig } from "./config.ts";
import { QuickChatCapture } from "./capture.ts";
import { macQuickChatCapture } from "./mac-capture.ts";
import { macQuickChatFocus } from "./focus.ts";
import type { ImageInput } from "./types.ts";
import { validateImages, validateImagePixels } from "./input.ts";

const directory = dirname(fileURLToPath(import.meta.url));
const config = readConfig(process.env);
// Automated tests must supply an existing dedicated temp home. They never touch OS capture or shortcuts.
const isolated = process.argv.includes("--isolated-test");
if (isolated) {
  const root = process.env.ZPI_QUICK_CHAT_TEST_HOME;
  if (
    !root ||
    !isAbsolute(root) ||
    !realpathSync(root).startsWith(`${realpathSync(app.getPath("temp"))}/zpi-quick-chat-test-`)
  )
    throw new Error("An isolated test home is required");
  app.setPath("userData", join(root, "user-data"));
  app.setPath("sessionData", join(root, "session-data"));
  if (process.platform === "darwin") app.setActivationPolicy("prohibited");
} else app.setPath("userData", join(app.getPath("appData"), "zpi-quick-chat"));
app.setName("ZPI Quick Chat");
if (!app.requestSingleInstanceLock()) app.exit(0);
else
  void start().catch((error) => {
    console.error("zpi-quick-chat:", error.message);
    app.exit(1);
  });

async function start() {
  await app.whenReady();
  if (!isolated) app.dock?.hide();
  let expanded = false,
    keepExpanded = false,
    hasMessages = false,
    occupied = false,
    compactHeight = 44,
    pinned = false;
  const bounds = (display: Electron.Display, width: number, height: number) => {
    const area = display.workArea,
      bottomInset = Math.max(0, display.bounds.y + display.bounds.height - area.y - area.height),
      gap = bottomInset > 4 ? bottomInset : 64;
    width = Math.min(width, area.width);
    height = Math.min(height, area.height);
    return {
      width,
      height,
      x: Math.round(Math.max(area.x, Math.min(display.bounds.x + (display.bounds.width - width) / 2, area.x + area.width - width))),
      y: Math.round(Math.max(area.y, area.y + area.height - gap - height)),
    };
  };
  const win = new BrowserWindow({
    ...bounds(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), 360, compactHeight),
    minWidth: 360,
    minHeight: 44,
    maxWidth: 1100,
    show: false,
    focusable: !isolated,
    frame: false,
    // CSS draws the capsule/dialog corners; native corners add a second outline on macOS.
    roundedCorners: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    ...(process.platform === "darwin" ? { type: "panel", hiddenInMissionControl: true } : {}),
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(directory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  let restoreFocus: (() => void) | undefined;
  const layout = (nextExpanded: boolean, height = compactHeight) => {
    compactHeight = height;
    const changed = expanded !== nextExpanded;
    expanded = nextExpanded;
    if (!expanded) pinned = false;
    if (!changed && expanded) return;
    const current = win.getBounds(),
      display = screen.getDisplayMatching(current),
      next = bounds(display, expanded ? 660 : 360, expanded ? 560 : compactHeight);
    if (changed) {
      win.setMinimumSize(Math.min(expanded ? 440 : 360, next.width), Math.min(expanded ? 360 : 44, next.height));
    }
    if (current.x !== next.x || current.y !== next.y || current.width !== next.width || current.height !== next.height)
      win.setBounds(next);
  };
  const activate = macQuickChatFocus(
    join(directory, "native"),
    () => app.focus({ steal: true }),
    (error) => console.error("Window focus:", error),
  );
  const show = () => {
    if (isolated || win.isDestroyed()) return;
    if (!win.isVisible() && keepExpanded && !hasMessages && !occupied) {
      keepExpanded = false;
      layout(false);
      win.webContents.send("quick-chat:snapshot", { ...chat.snapshot(), expanded, pinned });
    }
    if (!win.isVisible() || !win.isFocused()) {
      const current = win.getBounds(),
        display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),
        next = bounds(display, expanded ? 660 : 360, expanded ? 560 : compactHeight);
      if (next.width !== current.width || next.height !== current.height)
        win.setMinimumSize(Math.min(expanded ? 440 : 360, next.width), Math.min(expanded ? 360 : 44, next.height));
      if (current.x !== next.x || current.y !== next.y || current.width !== next.width || current.height !== next.height)
        win.setBounds(next);
    }
    const needsFocus = !win.isFocused();
    win.show();
    if (needsFocus) restoreFocus = activate() ?? restoreFocus;
    win.focus();
  };
  const hide = () => {
    if (!win.isDestroyed()) win.hide();
    restoreFocus?.();
    restoreFocus = undefined;
  };
  win.on("blur", () => {
    // Cocoa may deliver the previous hide's blur during a new synchronous show.
    queueMicrotask(() => {
      if (win.isDestroyed() || win.isFocused()) return;
      restoreFocus = undefined;
      if ((!expanded || !pinned) && win.isVisible()) hide();
    });
  });
  let testOptions = {};
  if (isolated && process.env.ZPI_QUICK_CHAT_TEST_API) {
    const url = new URL(process.env.ZPI_QUICK_CHAT_TEST_API);
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:")
      throw new Error("Tests require a loopback API");
    testOptions = {
      model: "test",
      zpi: {
        agentDir: join(process.env.ZPI_QUICK_CHAT_TEST_HOME!, "sdk"),
        providers: {
          test: {
            apiKey: "test",
            baseUrl: url.href,
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
    };
  }
  const chat = new Chat(
    config,
    (update) => {
      if (!win.isDestroyed()) {
        if ("type" in update) win.webContents.send("quick-chat:text", update);
        else {
          hasMessages = update.messages.length > 0;
          layout(hasMessages || keepExpanded);
          win.webContents.send("quick-chat:snapshot", { ...update, expanded, pinned });
        }
      }
    },
    testOptions,
  );
  const capture = new QuickChatCapture({
    sessionId: () => String(chat.generation),
    hide,
    read: macQuickChatCapture({
      platform: process.platform,
      testMode: isolated,
      temporaryDirectory: app.getPath("temp"),
      copyHelper: join(directory, "native/copy-selection"),
      clipboard,
      accessibilityAccess: () => systemPreferences.isTrustedAccessibilityClient(false),
    }),
    open: async (draft) => {
      show();
      win.webContents.send("quick-chat:draft", draft);
    },
  });
  const doCapture = (kind: "selection" | "clipboard" | "screenshot") =>
    void capture.invoke(kind).catch((error) => {
      show();
      win.webContents.send("quick-chat:draft", { error: error.message });
    });
  const reset = () => {
    keepExpanded = expanded && win.isVisible();
    pinned = false;
    occupied = false;
    compactHeight = 44;
    void chat.reset().catch((error) => console.error("Conversation cleanup:", error));
    show();
  };
  ipcMain.handle("quick-chat:action", async (event, action: unknown, input: unknown) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
      throw new Error("Untrusted sender");
    try {
      switch (action) {
        case "send": {
          if (!input || typeof input !== "object" || Array.isArray(input))
            throw new Error("Invalid message");
          const value = input as { text: string; images?: ImageInput[]; generation: number };
          if (value.generation !== chat.generation || !Array.isArray(value.images ?? []))
            throw new Error("会话已切换，请重新发送");
          const images = value.images ?? [];
          validateImages(images);
          // Native decoding remains in the main process, after transport bounds checks.
          for (const image of images) {
            const decoded = nativeImage.createFromBuffer(Buffer.from(image.data, "base64")),
              size = decoded.getSize();
            validateImagePixels(size.width, size.height);
          }
          chat.send(value.text, value.images);
          break;
        }
        case "stop":
          await chat.stop();
          break;
        case "reset":
          reset();
          break;
        case "pin": {
          const value = input as { generation?: number; pinned?: boolean } | null;
          if (!value || typeof value.pinned !== "boolean") throw new Error("Invalid pin state");
          if (value.generation !== chat.generation) throw new Error("会话已切换，请重试");
          pinned = expanded && value.pinned;
          win.webContents.send("quick-chat:snapshot", { ...chat.snapshot(), expanded, pinned });
          break;
        }
        case "hide":
          hide();
          break;
        case "quit":
          app.quit();
          break;
        case "snapshot":
          win.webContents.send("quick-chat:snapshot", { ...chat.snapshot(), expanded, pinned });
          break;
        case "copy":
          if (isolated) throw new Error("OS clipboard access is disabled in tests");
          if (typeof input !== "string" || input.length > 2 * 1024 * 1024)
            throw new Error("Invalid copy text");
          clipboard.writeText(input);
          break;
        case "resize": {
          const value = input as { generation?: number; height?: number; occupied?: boolean } | null;
          if (!value || typeof value.height !== "number" || !Number.isFinite(value.height) || typeof value.occupied !== "boolean")
            throw new Error("Invalid height");
          if (value.generation === chat.generation) {
            occupied = value.occupied;
            if (!expanded) layout(false, Math.max(44, Math.min(Math.ceil(value.height), 320)));
          }
          break;
        }
        default:
          throw new Error("Unknown action");
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      hide();
    }
  });
  app.on("second-instance", show);
  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    globalShortcut.unregisterAll();
    capture.dispose();
    hide();
    void chat.close().finally(() => {
      ipcMain.removeHandler("quick-chat:action");
      win.destroy();
      app.quit();
    });
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => app.quit());
  await win.loadFile(join(directory, "index.html"));
  if (!isolated) {
    const bindings: [string, () => void][] = [
      ["Alt+Space", () => (win.isVisible() ? hide() : show())],
      ["Alt+Shift+Space", reset],
      ["Alt+Shift+C", () => doCapture("selection")],
      ["Alt+Shift+V", () => doCapture("clipboard")],
      ["Alt+Shift+A", () => doCapture("screenshot")],
    ];
    for (const [key, action] of bindings)
      if (!globalShortcut.register(key, action))
        throw new Error(`无法注册快捷键 ${key}，请关闭占用该快捷键的程序后重试`);
  }
  if (!isolated) show();
}
