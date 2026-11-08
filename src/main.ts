import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
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
const windowBackground = () => (nativeTheme.shouldUseDarkColors ? "#202020" : "#fafafa");
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
  const win = new BrowserWindow({
    width: 640,
    height: 300,
    minWidth: 440,
    minHeight: 220,
    maxWidth: 1100,
    show: false,
    focusable: !isolated,
    frame: false,
    roundedCorners: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: join(directory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !isolated,
    },
  });
  const syncWindowBackground = () => {
    if (!win.isDestroyed()) win.setBackgroundColor(windowBackground());
  };
  nativeTheme.on("updated", syncWindowBackground);
  win.on("closed", () => nativeTheme.off("updated", syncWindowBackground));
  let restoreFocus: (() => void) | undefined;
  const activate = macQuickChatFocus(
    join(directory, "native"),
    () => app.focus({ steal: true }),
    (error) => console.error("Window focus:", error),
  );
  const show = () => {
    if (isolated || win.isDestroyed()) return;
    if (!win.isVisible()) {
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,
        bounds = win.getBounds();
      win.setPosition(
        Math.round(area.x + (area.width - bounds.width) / 2),
        Math.round(area.y + area.height * 0.22),
      );
    }
    if (!win.isFocused()) restoreFocus = activate();
    win.show();
    win.focus();
  };
  const hide = () => {
    if (!win.isDestroyed()) win.hide();
    restoreFocus?.();
    restoreFocus = undefined;
  };
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
      if (!win.isDestroyed())
        win.webContents.send("type" in update ? "quick-chat:text" : "quick-chat:snapshot", update);
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
  const reset = async () => {
    await chat.reset();
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
          await reset();
          break;
        case "hide":
          hide();
          break;
        case "quit":
          app.quit();
          break;
        case "snapshot":
          win.webContents.send("quick-chat:snapshot", chat.snapshot());
          break;
        case "copy":
          if (isolated) throw new Error("OS clipboard access is disabled in tests");
          if (typeof input !== "string" || input.length > 2 * 1024 * 1024)
            throw new Error("Invalid copy text");
          clipboard.writeText(input);
          break;
        case "resize": {
          if (isolated) break;
          if (typeof input !== "number" || !Number.isFinite(input)) throw new Error("Invalid height");
          const area = screen.getDisplayMatching(win.getBounds()).workArea;
          win.setSize(
            win.getBounds().width,
            Math.max(220, Math.min(Math.ceil(input), Math.floor(area.height * 0.8))),
          );
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
      ["Alt+Space", () => (win.isVisible() && win.isFocused() ? hide() : show())],
      [
        "Alt+Shift+Space",
        () => {
          void reset();
        },
      ],
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
