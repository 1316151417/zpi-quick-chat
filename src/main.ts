import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
  systemPreferences,
} from "electron";
import { dirname, isAbsolute, join } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Chat } from "./chat.ts";
import { readConfig } from "./config.ts";
import { QuickChatCapture } from "./capture.ts";
import { macQuickChatCapture } from "./mac-capture.ts";
import { macQuickChatFocus, macQuickChatFocusWatch } from "./focus.ts";
import type { ImageInput, ToolOptions } from "./types.ts";
import { publicWebUrl } from "./web.ts";
import { validateImages, validateImagePixels } from "./input.ts";
import { defaultWindowSize, resizedWindowBounds, resizeEdges, windowBounds, windowSizes, type ResizeEdge } from "./window.ts";

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
    previewing = false,
    keepExpanded = false,
    hasMessages = false,
    occupied = false,
    compactHeight: number = windowSizes.compactHeight,
    expandedInset = 0,
    pinned = false;
  let position: Electron.Rectangle | undefined;
  let preferredDefaults: ReturnType<typeof defaultWindowSize> | undefined;
  let expandedSize: Pick<Electron.Rectangle, "width" | "height"> | undefined;
  const bounds = (display: Electron.Display, wide: boolean) => {
    const targetDisplay = position ? screen.getDisplayMatching(position) : display,
      defaults = preferredDefaults ?? defaultWindowSize(targetDisplay),
      composerWidth = expandedSize ? Math.max(1, expandedSize.width - 2 * windowSizes.expandedSideInset) : defaults.width;
    return windowBounds(
      targetDisplay,
      expanded ? expandedSize?.width ?? composerWidth + 2 * windowSizes.expandedSideInset : wide ? windowSizes.previewWidth : composerWidth,
      expanded ? expandedSize?.height ?? defaults.expandedHeight : wide ? windowSizes.previewHeight : compactHeight,
      position,
      expanded ? expandedInset : 0,
      defaults.bottomGap,
    );
  };
  const win = new BrowserWindow({
    ...bounds(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), false),
    minWidth: 360,
    minHeight: windowSizes.compactHeight,
    maxWidth: 1100,
    show: false,
    focusable: !isolated,
    frame: false,
    // CSS draws the capsule/dialog corners; native corners add a second outline on macOS.
    roundedCorners: false,
    // Native shadows can add a second rim around transparent content on macOS.
    hasShadow: false,
    transparent: true,
    // Transparent windows use renderer edge grips; changing native resize styles can clip the surface.
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
  let appliedBounds = win.getBounds(),
    appliedInset = 0,
    animation: ReturnType<typeof setInterval> | undefined,
    animationTarget: Electron.Rectangle | undefined;
  let resizeDrag: { frame: Electron.Rectangle; edge: ResizeEdge; x: number; y: number } | undefined;
  const cancelAnimation = () => {
    clearInterval(animation);
    animation = undefined;
    animationTarget = undefined;
  };
  const rememberPosition = () => {
    const current = win.getBounds();
    // Read the final native position: macOS will-move reports the pre-drag frame.
    // Compare against our last layout so programmatic moves do not become preferences.
    if (current.x !== appliedBounds.x || current.y !== appliedBounds.y ||
        current.width !== appliedBounds.width || current.height !== appliedBounds.height) {
      // Store the composer's bottom, excluding the expanded window's outer padding.
      // Freeze the source screen's defaults when dragged, including across displays.
      preferredDefaults ??= defaultWindowSize(screen.getDisplayMatching(appliedBounds));
      position = { ...current, y: current.y - appliedInset };
      if (expanded && !animation) expandedSize = { width: current.width, height: current.height };
      cancelAnimation();
    }
    appliedBounds = current;
    return current;
  };
  const sameBounds = (a: Electron.Rectangle, b: Electron.Rectangle) =>
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  const place = (next: Electron.Rectangle, animate = false) => {
    if (animate && animationTarget && sameBounds(animationTarget, next)) return;
    cancelAnimation();
    const start = win.getBounds(),
      wide = expanded || previewing,
      minWidth = Math.min(360 + (expanded ? 2 * windowSizes.expandedSideInset : 0), next.width),
      minHeight = Math.min(wide ? windowSizes.minimumExpandedHeight : windowSizes.compactHeight, next.height);
    appliedInset = expanded ? expandedInset : 0;
    const apply = (frame: Electron.Rectangle) => {
      if (!sameBounds(win.getBounds(), frame)) win.setBounds(frame);
      appliedBounds = win.getBounds();
    };
    const finish = () => {
      apply(next);
      win.setMinimumSize(minWidth, minHeight);
      appliedBounds = win.getBounds();
      cancelAnimation();
    };
    // Allow all intermediate frames before tightening the destination's minimum size.
    win.setMinimumSize(Math.min(start.width, minWidth), Math.min(start.height, minHeight));
    if (!animate || sameBounds(start, next) || (!win.isVisible() && !isolated) ||
        systemPreferences.getAnimationSettings().prefersReducedMotion) {
      finish();
      return;
    }
    animationTarget = next;
    const began = performance.now();
    animation = setInterval(() => {
      if (win.isDestroyed()) { cancelAnimation(); return; }
      const current = rememberPosition();
      // A manual move interrupts the animation and becomes the shared position.
      if (!animation) {
        place(bounds(screen.getDisplayMatching(current), expanded || previewing));
        return;
      }
      const progress = Math.min(1, (performance.now() - began) / 180),
        eased = 1 - (1 - progress) ** 3;
      if (progress === 1) { finish(); return; }
      const frame = { ...next };
      for (const key of ["x", "y", "width", "height"] as const)
        frame[key] = Math.round(start[key] + (next[key] - start[key]) * eased);
      apply(frame);
    }, 1000 / 60);
  };
  let restoreFocus: (() => void) | undefined,
    focusRevision = 0;
  const layout = (nextExpanded: boolean, height = compactHeight) => {
    // Capture the final dragged frame before changing the native size.
    const current = rememberPosition();
    compactHeight = height;
    const changed = expanded !== nextExpanded;
    if (changed && expanded) {
      // Collapse to the actual composer, including after resizing or switching screens.
      // Use the settled destination if an expansion was interrupted before its last frame.
      const frame = animationTarget ?? current;
      expandedSize = { width: frame.width, height: frame.height };
      position = { ...frame, y: frame.y - appliedInset };
      preferredDefaults ??= defaultWindowSize(screen.getDisplayMatching(frame));
    }
    expanded = nextExpanded;
    if (!expanded) pinned = false;
    if (!changed && expanded && appliedInset === expandedInset) return;
    const display = screen.getDisplayMatching(current),
      wide = expanded || previewing,
      next = bounds(display, wide);
    place(next, changed || current.width !== next.width);
  };
  const activate = macQuickChatFocus(
    join(directory, "native"),
    () => app.focus({ steal: true }),
    (error) => console.error("Window focus:", error),
  );
  const show = () => {
    if (win.isDestroyed()) return;
    focusRevision++;
    rememberPosition();
    if (!win.isVisible() && keepExpanded && !hasMessages && !occupied) {
      keepExpanded = false;
      layout(false);
      win.webContents.send("quick-chat:snapshot", { ...chat.snapshot(), expanded, pinned });
    }
    if (!win.isVisible() || !win.isFocused()) {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),
        wide = expanded || previewing,
        next = bounds(display, wide);
      place(next);
    }
    if (isolated) return;
    const needsFocus = !win.isFocused();
    win.show();
    if (needsFocus) restoreFocus = activate() ?? restoreFocus;
    win.focus();
    focusWatch?.reset();
  };
  const hide = () => {
    focusRevision++;
    resizeDrag = undefined;
    if (!win.isDestroyed()) {
      rememberPosition();
      // Never reopen at an unfinished animation frame.
      if (animationTarget) place(animationTarget);
      win.hide();
    }
    restoreFocus?.();
    restoreFocus = undefined;
  };
  const onFocusLoss = (application = false) => {
    const revision = focusRevision;
    // Let native focus changes settle. A later show/focus invalidates an old notification.
    setImmediate(() => {
      if (revision !== focusRevision || win.isDestroyed() || (!application && win.isFocused())) return;
      restoreFocus = undefined;
      if ((!expanded || !pinned) && win.isVisible()) hide();
    });
  };
  win.on("blur", () => onFocusLoss());
  win.on("focus", () => { focusRevision++; });
  // A macOS panel can retain key-window status while another application becomes active.
  // Application deactivation must not depend on BrowserWindow.isFocused().
  app.on("did-resign-active", () => onFocusLoss(true));
  app.on("did-become-active", () => { focusRevision++; });
  const focusWatch = !isolated && process.platform === "darwin" ? macQuickChatFocusWatch(
    join(directory, "native"),
    () => !win.isDestroyed() && win.isVisible(),
    () => {
      restoreFocus = undefined;
      if (!expanded || !pinned) hide();
    },
    (error) => console.error("Window focus watcher:", error),
  ) : undefined;
  let testOptions = {};
  if (isolated && process.env.ZPI_QUICK_CHAT_TEST_API) {
    const url = new URL(process.env.ZPI_QUICK_CHAT_TEST_API);
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:")
      throw new Error("Tests require a loopback API");
    testOptions = {
      cwd: process.env.ZPI_QUICK_CHAT_TEST_HOME!,
      model: "test",
      zpi: {
        fetch: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          const target = new URL(input instanceof Request ? input.url : String(input));
          if (target.origin === "https://api.deepseek.com" && /^\/v1\/tools\/(search|fetch)$/.test(target.pathname))
            return fetch(new URL(target.pathname, url.origin), init);
          if (target.origin !== url.origin) throw new Error("External network access is disabled in tests");
          return fetch(input, init);
        },
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
    resizeDrag = undefined;
    keepExpanded = expanded && win.isVisible();
    previewing = false;
    pinned = false;
    occupied = false;
    compactHeight = windowSizes.compactHeight;
    void chat.reset().catch((error) => console.error("Conversation cleanup:", error));
    show();
  };
  ipcMain.handle("quick-chat:action", async (event, action: unknown, input: unknown) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
      throw new Error("Untrusted sender");
    try {
      switch (action) {
        case "tools": {
          const value = input as { generation?: number; tools?: ToolOptions } | null;
          if (!value || value.generation !== chat.generation) throw new Error("会话已切换，请重试");
          chat.configure(value.tools!);
          break;
        }
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
        case "preview": {
          const value = input as { generation?: number; open?: boolean } | null;
          if (!value || typeof value.open !== "boolean") throw new Error("Invalid preview state");
          if (value.generation !== chat.generation) throw new Error("会话已切换，请重试");
          previewing = value.open;
          resizeDrag = undefined;
          layout(expanded);
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
        case "open-url": {
          const url = publicWebUrl(input);
          if (!url) throw new Error("仅支持打开不含凭据的公网 HTTP/HTTPS 网址");
          if (isolated) throw new Error("OS browser access is disabled in tests");
          await shell.openExternal(url);
          break;
        }
        case "resize-window": {
          const value = input as { generation?: number; phase?: string; edge?: string; x?: number; y?: number } | null;
          if (!value || !["start", "move", "end"].includes(value.phase ?? "") ||
              !resizeEdges.includes(value.edge as ResizeEdge) ||
              typeof value.x !== "number" || !Number.isFinite(value.x) || Math.abs(value.x) > 1000000 ||
              typeof value.y !== "number" || !Number.isFinite(value.y) || Math.abs(value.y) > 1000000)
            throw new Error("Invalid window resize");
          if (value.generation !== chat.generation) throw new Error("会话已切换，请重试");
          if (!expanded || previewing) { resizeDrag = undefined; break; }
          if (value.phase === "start") {
            if (animationTarget) place(animationTarget);
            resizeDrag = { frame: rememberPosition(), edge: value.edge as ResizeEdge, x: value.x, y: value.y };
          } else if (resizeDrag) {
            if (value.phase === "end") { resizeDrag = undefined; break; }
            const next = resizedWindowBounds(screen.getDisplayMatching(resizeDrag.frame), resizeDrag.frame,
              resizeDrag.edge, value.x - resizeDrag.x, value.y - resizeDrag.y);
            win.setBounds(next);
            rememberPosition();
          }
          break;
        }
        case "resize": {
          const value = input as { generation?: number; height?: number; expandedInset?: number; occupied?: boolean } | null;
          if (!value || typeof value.height !== "number" || !Number.isFinite(value.height) || typeof value.occupied !== "boolean" ||
              typeof value.expandedInset !== "number" || !Number.isFinite(value.expandedInset) || value.expandedInset < 0 || value.expandedInset > 64)
            throw new Error("Invalid height");
          if (value.generation === chat.generation) {
            occupied = value.occupied;
            expandedInset = value.expandedInset;
            if (!expanded && !previewing) layout(false, Math.max(windowSizes.compactHeight, Math.min(Math.ceil(value.height), 512)));
            else if (expanded && appliedInset !== expandedInset) layout(true);
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
    focusWatch?.stop();
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
