import { test, expect, _electron as electron } from "@playwright/test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { server } from "./server.ts";
const require = createRequire(import.meta.url);
test("hidden isolated window chats through SDK, resets and exposes no desktop settings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zpi-quick-chat-test-")),
    api = await server({ delayMs: 40 });
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const source = require("electron") as string,
      bundle = join(dir, "Electron.app");
    await cp(resolve(dirname(source), "../.."), bundle, {
      recursive: true,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
    });
    execFileSync("/usr/bin/plutil", [
      "-replace",
      "LSUIElement",
      "-bool",
      "YES",
      join(bundle, "Contents/Info.plist"),
    ]);
    const loader = join(
      dirname(require.resolve("playwright-core/package.json")),
      "lib/server/electron/loader.js",
    );
    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
      DEEPSEEK_API_KEY: "synthetic",
      ZPI_QUICK_CHAT_TEST_HOME: dir,
      ZPI_QUICK_CHAT_TEST_API: api.url,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    application = await electron.launch({
      executablePath: join(bundle, "Contents/MacOS/Electron"),
      args: ["-r", loader, resolve("dist/main.js"), "--isolated-test"],
      env,
      timeout: 15000,
    });
    const page = await application.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForLoadState("domcontentloaded");
    const input = page.getByLabel("输入内容", { exact: true });
    const size = () => application!.evaluate(({ BrowserWindow }) => {
      const { width, height } = BrowserWindow.getAllWindows()[0].getBounds();
      return { width, height };
    });
    const position = async () => {
      const frame = await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
      const inset = await page.locator("#composer").evaluate((node) =>
        document.body.classList.contains("expanded") ? innerHeight - node.getBoundingClientRect().bottom : 0);
      return { center: frame.x + frame.width / 2, bottom: frame.y + frame.height - inset };
    };
    const drag = (offset: number) => application!.evaluate(({ BrowserWindow, screen }, offset) => {
      const win = BrowserWindow.getAllWindows()[0],
        current = win.getBounds(),
        area = screen.getDisplayMatching(current).workArea,
        next = { ...current, x: area.x + offset, y: area.y + area.height - current.height - offset };
      // Change native coordinates without injecting a synthetic drag notification.
      win.setBounds(next);
    }, offset);
    const reopen = async () => {
      await page.evaluate(() => window.quickChat.invoke("hide"));
      // Isolated mode runs the real placement path while keeping native visibility disabled.
      await application!.evaluate(({ app }) => { app.emit("second-instance", {}, [], ""); });
    };
    const checkCorners = async (name: string) => {
      const screenshot = await page.screenshot({ omitBackground: true, path: test.info().outputPath(`${name}.png`) });
      const alpha = await application!.evaluate(({ nativeImage }, png) => {
        const image = nativeImage.createFromBuffer(Buffer.from(png, "base64")),
          { width, height } = image.getSize(),
          pixels = image.toBitmap();
        return [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1], [width >> 1, height >> 1]]
          .map(([x, y]) => pixels[(y * width + x) * 4 + 3]);
      }, screenshot.toString("base64"));
      expect(alpha, `${name}: transparent corners and opaque center`).toEqual([0, 0, 0, 0, 255]);
    };
    await expect.poll(size).toEqual({ width: 360, height: 44 });
    await drag(220);
    const compactPosition = await position();
    await reopen();
    expect(await position()).toEqual(compactPosition);
    await expect(page.locator("body")).not.toHaveClass("expanded");
    const web = page.getByRole("button", { name: "联网搜索", exact: true }),
      bash = page.getByRole("button", { name: "本机工具", exact: true });
    await expect(web).toHaveAttribute("aria-pressed", "false");
    await expect(bash).toHaveAttribute("aria-pressed", "false");
    await expect(bash).toHaveAttribute("title", /查找文件、读取文字和图片、执行命令/);
    await web.click();
    await expect(web).toHaveAttribute("aria-pressed", "true");
    await bash.click();
    await expect(bash).toHaveAttribute("aria-pressed", "true");
    await expect(web).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: test.info().outputPath("tools-selected.png") });
    await web.click();
    await bash.click();
    await expect(web).toHaveAttribute("aria-pressed", "false");
    await expect(bash).toHaveAttribute("aria-pressed", "false");
    expect(await input.evaluate((node) => node.getBoundingClientRect().height)).toBe(24);
    const pin = page.getByRole("button", { name: "固定窗口", exact: true });
    await expect(pin).toBeHidden();
    // Old versions persisted this preference; it must no longer auto-pin either mode.
    await page.evaluate(() => localStorage.setItem("pinned", "true"));
    await page.reload();
    await expect(pin).toBeHidden();
    await expect(page.locator("#pin")).toHaveAttribute("aria-pressed", "false");
    const generation = await page.evaluate(() => new Promise<number>((resolve) => {
      const off = window.quickChat.onSnapshot((snapshot) => { off(); resolve(snapshot.generation); });
      void window.quickChat.invoke("snapshot");
    }));
    await page.evaluate((generation) => window.quickChat.invoke("pin", { generation, pinned: true }), generation);
    await expect(page.locator("#pin")).toHaveAttribute("aria-pressed", "false");
    expect(await page.locator("#composer").evaluate((node) => getComputedStyle(node).paddingRight)).toBe("8px");
    await page.screenshot({ path: test.info().outputPath("compact.png") });
    await checkCorners("compact-light");
    expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hasShadow())).toBe(false);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("#composer")).toHaveCSS("background-color", "rgb(43, 43, 43)");
    await page.screenshot({ path: test.info().outputPath("compact-dark.png") });
    await checkCorners("compact-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await input.fill("一\n二\n三");
    await expect.poll(size).toEqual({ width: 360, height: 88 });
    expect(await position()).toEqual(compactPosition);
    await reopen();
    expect(await position()).toEqual(compactPosition);
    await input.fill("多行内容\n".repeat(30));
    await expect.poll(size).toEqual({ width: 360, height: 184 });
    await input.fill("");
    await expect.poll(size).toEqual({ width: 360, height: 44 });
    await input.fill("已有草稿");
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send("quick-chat:draft", { text: "带入内容🙂" });
    });
    await expect(input).toHaveValue("已有草稿\n带入内容🙂");
    expect(await input.evaluate((node: HTMLTextAreaElement) => ({
      start: node.selectionStart, end: node.selectionEnd, length: node.value.length,
    }))).toEqual({ start: 11, end: 11, length: 11 });
    await input.press("x");
    await expect(input).toHaveValue("已有草稿\n带入内容🙂x");
    await input.fill("输入法候选");
    await input.evaluate((node) => {
      node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      node.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      for (const modifiers of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }, { metaKey: true }])
        node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...modifiers }));
    });
    expect(api.requests).toHaveLength(0);
    await expect(page.locator(".message")).toHaveCount(0);
    await input.fill("");
    const pasteImages = (files: { name: string; mimeType: string; buffer: Buffer }[]) =>
      page.evaluate(
        (files) => {
          const transfer = new DataTransfer();
          for (const file of files)
            transfer.items.add(
              new File([new Uint8Array(file.bytes)], file.name, { type: file.mimeType }),
            );
          const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
          Object.defineProperty(event, "clipboardData", { value: transfer });
          document.getElementById("input")!.dispatchEvent(event);
        },
        files.map((file) => ({ name: file.name, mimeType: file.mimeType, bytes: [...file.buffer] })),
      );
    const pictures = await application.evaluate(({ nativeImage }) => {
      const image = nativeImage.createFromBuffer(Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWP4z8AAQVDqPwMDAEHSBfsYFwTiAAAAAElFTkSuQmCC",
        "base64",
      ));
      return [
        { name: "one.png", bytes: [...image.resize({ width: 600, height: 1800 }).toPNG()] },
        { name: "wide.png", bytes: [...image.resize({ width: 1800, height: 600 }).toPNG()] },
      ];
    });
    await pasteImages(pictures.map((picture) => ({ name: picture.name, mimeType: "image/png", buffer: Buffer.from(picture.bytes) })));
    await expect(page.locator("#images img")).toHaveCount(2);
    await expect.poll(size).toEqual({ width: 360, height: 100 });
    const viewer = page.getByRole("dialog", { name: "图片预览" });
    await input.fill("预览前的草稿\n第二行\n第三行");
    await expect.poll(size).toEqual({ width: 360, height: 144 });
    for (const [index, picture] of pictures.entries()) {
      const motion = index === 0 ? application.evaluate(async ({ BrowserWindow, systemPreferences }) => {
        const frames: { center: number; bottom: number; width: number }[] = [],
          timer = setInterval(() => {
            const { x, y, width, height } = BrowserWindow.getAllWindows()[0].getBounds();
            frames.push({ center: x + width / 2, bottom: y + height, width });
          }, 8);
        await new Promise((resolve) => setTimeout(resolve, 350));
        clearInterval(timer);
        return { frames, reduced: systemPreferences.getAnimationSettings().prefersReducedMotion };
      }) : undefined;
      await page.getByRole("button", { name: `预览 ${picture.name}`, exact: true }).click();
      await expect(viewer).toBeVisible();
      // Hiding during the transition must settle it before the next reveal.
      if (index === 1) await reopen();
      await expect.poll(size).toEqual({ width: 660, height: 560 });
      expect(await position()).toEqual(compactPosition);
      if (motion) {
        const { frames, reduced } = await motion;
        if (!reduced) expect(frames.some(({ width }) => width > 360 && width < 660)).toBe(true);
        for (const frame of frames) {
          expect(Math.abs(frame.center - compactPosition.center)).toBeLessThanOrEqual(1);
          expect(Math.abs(frame.bottom - compactPosition.bottom)).toBeLessThanOrEqual(1);
        }
      }
      await expect(page.locator("body")).not.toHaveClass("expanded");
      await expect(viewer.locator("img")).toHaveJSProperty("complete", true);
      expect(await viewer.locator("img").evaluate((image: HTMLImageElement) => {
        const rect = image.getBoundingClientRect();
        return {
          fits: rect.top >= 36 && rect.left >= 16 && rect.right <= innerWidth - 16 && rect.bottom <= innerHeight - 16,
          undistorted: Math.abs(rect.width / rect.height - image.naturalWidth / image.naturalHeight) < 0.01,
        };
      })).toEqual({ fits: true, undistorted: true });
      await checkCorners(`preview-${index}`);
      if (index === 0) await page.keyboard.press("Escape");
      else await viewer.getByRole("button", { name: "关闭图片预览" }).click();
      await expect(viewer).toBeHidden();
      await expect.poll(size).toEqual({ width: 360, height: 144 });
      expect(await position()).toEqual(compactPosition);
      await expect(input).toHaveValue("预览前的草稿\n第二行\n第三行");
      await expect(page.locator("#images img")).toHaveCount(2);
    }
    // Reverse an expansion before it completes without retaining an intermediate anchor.
    await page.getByRole("button", { name: "预览 one.png", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
    await expect.poll(size).toEqual({ width: 360, height: 144 });
    expect(await position()).toEqual(compactPosition);
    await input.fill("Translate hello");
    await input.evaluate((node) => {
      for (let index = 0; index < 2; index++)
        node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await expect(page.locator(".assistant .message-text")).toContainText("你");
    await expect(page.locator("#stop")).toBeVisible();
    await expect(page.locator(".assistant")).toContainText("你好，世界");
    await expect(page.locator(".assistant").getByRole("button", { name: "复制", exact: true })).toBeVisible();
    await expect(page.locator(".user").getByRole("button", { name: "复制", exact: true })).toBeVisible();
    await expect(page.locator("#stop")).toBeHidden();
    expect(api.requests).toHaveLength(1);
    await expect.poll(size).toEqual({ width: 660, height: 560 });
    expect(await position()).toEqual(compactPosition);
    await drag(100);
    const expandedPosition = await position();
    await reopen();
    expect(await position()).toEqual(expandedPosition);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await checkCorners(`expanded-${colorScheme}`);
    }
    await page.emulateMedia({ colorScheme: "light" });
    await expect(pin).toBeVisible();
    await expect(pin).toHaveAttribute("aria-pressed", "false");
    await pin.click();
    await expect(pin).toHaveAttribute("aria-pressed", "true");
    await pin.click();
    await expect(pin).toHaveAttribute("aria-pressed", "false");
    await pin.click();
    await expect(pin).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#error")).toBeHidden();
    await page.locator(".assistant").evaluate((node) => node.setAttribute("data-preserved", "true"));
    await page.screenshot({ path: test.info().outputPath("expanded.png") });
    await page.locator(".assistant .answer").evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
    await page.evaluate(() => window.quickChat.invoke("snapshot"));
    expect(await page.evaluate(() => window.getSelection()!.toString())).toBe("你好，世界");
    await input.fill("多行输入\n".repeat(30));
    expect(await input.evaluate((node) => node.getBoundingClientRect().height)).toBe(160);
    expect(await size()).toEqual({ width: 660, height: 560 });
    await input.fill("Continue");
    await input.press("Enter");
    await expect(page.locator(".assistant").last()).toContainText("继续对话");
    await expect(page.locator(".assistant").first()).toHaveAttribute("data-preserved", "true");
    expect(JSON.stringify(api.requests[0].messages)).toContain("image_url");
    expect(JSON.stringify((api.requests[0].messages as { role: string }[]).filter((message) => message.role === "system")))
      .toContain("你是一个有用的助手，帮助用户完成任务。要求回复极简、本质、清晰、易懂。");
    expect(JSON.stringify(api.requests[1].messages)).toContain("Translate hello");
    await input.fill("滚动内容\n".repeat(30));
    await input.evaluate((node: HTMLTextAreaElement) => { node.scrollTop = 0; });
    await input.hover();
    await page.mouse.wheel(0, 400);
    await expect.poll(() => input.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: test.info().outputPath("scrollbars-dark.png") });
    await input.fill("");
    expect(
      await page.evaluate(() => ({
        zpi: "zpi" in window,
        node: "require" in window,
        settings: document.body.textContent?.includes("模型设置"),
      })),
    ).toEqual({ zpi: false, node: false, settings: false });
    const native = await application.evaluate(({ BrowserWindow, globalShortcut }) => ({
      visible: BrowserWindow.getAllWindows().some((window) => window.isVisible()),
      registered: globalShortcut.isRegistered("Alt+Space"),
    }));
    expect(native).toEqual({ visible: false, registered: false });
    await page.getByRole("button", { name: "预览 one.png", exact: true }).click();
    await expect(viewer).toBeVisible();
    // Exercise the visible-window reset branch without exposing a native test window.
    await application.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0], isVisible = win.isVisible;
      win.isVisible = () => true;
      try {
        await win.webContents.executeJavaScript('window.quickChat.invoke("reset")');
      } finally {
        win.isVisible = isVisible;
      }
    });
    await expect(viewer).toBeHidden();
    await expect(page.locator("body")).toHaveClass("expanded");
    await expect.poll(size).toEqual({ width: 660, height: 560 });
    const closedComposerPosition = await position();
    expect(closedComposerPosition).toEqual(expandedPosition);
    await reopen();
    await expect(page.locator("body")).not.toHaveClass("expanded");
    await expect.poll(size).toEqual({ width: 360, height: 44 });
    expect(await position()).toEqual(closedComposerPosition);
    await reopen();
    expect(await position()).toEqual(closedComposerPosition);
    await expect(page.locator(".message")).toHaveCount(0);
    await expect(pin).toBeHidden();
    await expect(page.locator("#pin")).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate((generation) => window.quickChat.invoke("pin", { generation, pinned: true }), generation)).toMatchObject({ ok: false });
    // Hold FileReader completion so resets and concurrent selections exercise the real renderer.
    await page.evaluate(() => {
      const readers: FileReader[] = [];
      const original = FileReader.prototype.readAsDataURL;
      FileReader.prototype.readAsDataURL = function (this: FileReader) {
        readers.push(this);
      };
      Object.assign(window, {
        imageReaders: readers,
        releaseImage: (index: number, failed = false) => {
          const reader = readers[index];
          if (failed) reader.dispatchEvent(new ProgressEvent("error"));
          else {
            Object.defineProperty(reader, "result", { value: "data:image/png;base64,aGVsbG8=" });
            reader.dispatchEvent(new ProgressEvent("load"));
          }
        },
        restoreImageReader: () => {
          FileReader.prototype.readAsDataURL = original;
        },
      });
    });
    const file = (name: string) => ({ name, mimeType: "image/png", buffer: Buffer.from("synthetic") });
    const readerCount = () =>
      page.evaluate(() => (window as unknown as { imageReaders: FileReader[] }).imageReaders.length);
    const releaseImage = (index: number, failed = false) =>
      page.evaluate(
        ({ index, failed }) => {
          (window as unknown as { releaseImage(index: number, failed: boolean): void }).releaseImage(
            index,
            failed,
          );
        },
        { index, failed },
      );
    await pasteImages([file("old-a.png"), file("old-b.png")]);
    await expect.poll(readerCount).toBe(1);
    await input.fill("图片读取完才能发送");
    await input.press("Enter");
    await expect(page.locator(".message")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
    await page.evaluate(() => window.quickChat.invoke("reset"));
    await releaseImage(0);
    await expect(page.locator("#images img")).toHaveCount(0);
    expect(await readerCount()).toBe(1);

    await pasteImages([file("a.png"), file("b.png"), file("c.png")]);
    await pasteImages([file("d.png"), file("e.png"), file("f.png")]);
    for (let index = 1; index <= 6; index++) {
      await expect.poll(readerCount).toBeGreaterThan(index);
      await releaseImage(index);
    }
    await expect(page.locator("#images img")).toHaveCount(5);
    await expect(page.locator("#error")).toContainText("最多带入 5 张图片");
    await page.evaluate(() => window.quickChat.invoke("reset"));
    await pasteImages([file("cannot-read.png")]);
    await expect.poll(readerCount).toBe(8);
    await releaseImage(7, true);
    await expect(page.locator("#error")).toContainText("读取图片失败");
    expect(errors).toEqual([]);
    await page.evaluate(() =>
      (window as unknown as { restoreImageReader(): void }).restoreImageReader(),
    );
    await page.evaluate(() => window.quickChat.invoke("reset"));
    await expect(web).toHaveAttribute("aria-pressed", "false");
    await expect(bash).toHaveAttribute("aria-pressed", "false");
    await web.click();
    await bash.click();
    const localImagePath = join(dir, "local image.png");
    await writeFile(localImagePath, Buffer.from(pictures[0].bytes));
    api.queueCalls([
      { name: "web_search", input: { query: "测试来源", count: 3 } },
      { name: "web_fetch", input: { url: "https://example.com/source" } },
      { name: "Bash", input: { command: "printf desktop > desktop-proof.txt; pwd; cat desktop-proof.txt" } },
      { name: "Read", input: { file_path: localImagePath } },
    ], "## 任务已完成\n\n已读取**测试来源**，可查看[原文](https://example.com/source)。\n\n- 搜索\n- 阅读\n\n| 工具 | 状态 |\n| --- | --- |\n| Bash | 完成 |\n\n```sh\npwd\n```\n\n来源：<https://example.com/source>\n", { delayMs: 5, chunkSize: 8 });
    await input.fill("测试联网和本地工具");
    await input.press("Enter");
    await expect(web).toBeHidden();
    await expect(bash).toBeHidden();
    await expect(page.locator(".assistant .message-text")).toContainText("任务已完成");
    await expect(page.locator("#stop")).toBeHidden();
    const work = page.locator(".process");
    await expect(work).toHaveAttribute("data-complete", "true");
    expect(await work.evaluate((node: HTMLDetailsElement) => node.open)).toBe(false);
    await expect(page.locator(".answer h2")).toHaveText("任务已完成");
    await expect(page.locator(".answer strong")).toHaveText("测试来源");
    await expect(page.locator(".answer table")).toBeVisible();
    await expect(page.locator(".answer pre code")).toHaveText("pwd");
    await expect(page.locator(".answer")).not.toContainText("来源：");
    await page.screenshot({ path: test.info().outputPath("tools-completed.png") });
    await work.locator(":scope > summary").click();
    await expect(page.locator(".tool-call")).toHaveCount(4);
    await expect(page.locator(".tool-call").first().locator(".tool-summary-row")).toContainText("联网搜索查找 测试来源1 个来源");
    await expect(page.locator(".tool-call").first().locator("summary")).toHaveCount(0);
    await expect(page.locator(".answer a")).toHaveAttribute("href", "https://example.com/source");
    await page.locator(".tool-call").nth(2).locator("summary").click();
    await expect(page.locator(".tool-call").nth(2)).toContainText(dir);
    await expect(page.locator(".tool-call").nth(2)).toContainText("desktop");
    const read = page.locator(".tool-call").last();
    await expect(read.locator(".tool-summary-row")).toContainText("读取文件");
    await expect(read.locator(".tool-summary-text")).toHaveText(localImagePath);
    const thumbnail = read.getByRole("button", { name: `预览 ${localImagePath}`, exact: true });
    await expect(thumbnail).toBeVisible();
    await expect(thumbnail.locator("img")).toHaveJSProperty("naturalWidth", 600);
    await thumbnail.click();
    await expect(viewer).toBeVisible();
    await expect(viewer.locator("img")).toHaveAttribute("alt", localImagePath);
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
    await page.evaluate(() => window.quickChat.invoke("snapshot"));
    await expect(read.locator(".tool-images img")).toHaveCount(1);
    expect(JSON.stringify(api.requests.at(-1)?.messages)).toContain("image_url");
    expect(api.webRequests.map((request) => request.path)).toEqual(["/v1/tools/search", "/v1/tools/fetch"]);
    expect(JSON.stringify(api.requests.at(-1)?.messages)).toContain("zpi.environment");
    expect(JSON.stringify(api.requests.at(-1)?.messages)).not.toContain("当前工作目录");
    await page.screenshot({ path: test.info().outputPath("tools-expanded.png") });
    await page.evaluate(() => window.quickChat.invoke("snapshot"));
    expect(await work.evaluate((node: HTMLDetailsElement) => node.open)).toBe(true);
    await work.locator(":scope > summary").click();
    const sources = page.getByRole("button", { name: "来源，1 个网页", exact: true });
    expect(await sources.evaluate((node) => node.previousElementSibling?.classList.contains("copy"))).toBe(true);
    const time = page.locator(".assistant .message-time");
    await expect(time).toHaveText(/^\d{2}:\d{2}$/);
    expect(await time.evaluate((node) => node.previousElementSibling?.classList.contains("answer-sources-trigger"))).toBe(true);
    const answeredAt = await time.getAttribute("datetime");
    expect(Math.abs(Date.now() - Date.parse(answeredAt!))).toBeLessThan(10000);
    await sources.click();
    const popover = page.getByRole("dialog", { name: "来源 1", exact: true });
    await expect(popover).toBeVisible();
    await expect(page.locator(".answer-source-title")).toHaveText("测试来源");
    await expect(page.locator(".answer-source-site")).toHaveText("Example");
    expect(await popover.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return box.left >= 12 && box.top >= 12 && box.right <= innerWidth - 12 && box.bottom <= innerHeight - 12;
    })).toBe(true);
    await page.screenshot({ path: test.info().outputPath("sources-popover.png") });
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    await expect(sources).toHaveAttribute("aria-expanded", "false");
    await page.evaluate(() => window.quickChat.invoke("snapshot"));
    await expect(time).toHaveAttribute("datetime", answeredAt!);
    await sources.click();
    await input.click();
    await expect(popover).toBeHidden();
    const locked = await page.evaluate(() => new Promise<{ ok: boolean }>((resolve) => {
      const off = window.quickChat.onSnapshot((snapshot) => {
        off();
        void window.quickChat.invoke("tools", { generation: snapshot.generation, tools: { web: false, bash: false } }).then(resolve);
      });
      void window.quickChat.invoke("snapshot");
    }));
    expect(locked).toMatchObject({ ok: false });
    expect(await page.evaluate(() => window.quickChat.invoke("open-url", "javascript:alert(1)"))).toMatchObject({ ok: false });
    await page.evaluate(() => window.quickChat.invoke("reset"));
    await expect(web).toHaveAttribute("aria-pressed", "false");
    await expect(bash).toHaveAttribute("aria-pressed", "false");
    await expect.poll(size).toEqual({ width: 360, height: 44 });
    // Keep producing real SSE while the user scrolls up by less than the old 80px threshold.
    const longReply = Array.from({ length: 150 }, (_, index) => `第 ${index + 1} 段。**持续输出**，检查阅读位置保持不变。\n\n`).join("");
    await page.emulateMedia({ colorScheme: "light" });
    api.queueCalls([], longReply, { delayMs: 12, chunkSize: 16, initialDelayMs: 2300 });
    await input.fill("输出长文以测试滚动\n" + "用户输入内容\n".repeat(30));
    await input.press("Enter");
    const expandUser = page.getByRole("button", { name: "展开消息", exact: true });
    await expect(expandUser).toBeVisible();
    await expandUser.click();
    await expect(page.getByRole("button", { name: "收起消息", exact: true })).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("button", { name: "收起消息", exact: true }).click();
    await expect(expandUser).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("status", { name: "加载中", exact: true })).toBeVisible();
    await expect(page.locator(".process > summary")).toHaveText("工作中 2 秒");
    await page.screenshot({ path: test.info().outputPath("working.png") });
    const conversation = page.locator("#messages"), reply = page.locator(".assistant .message-text");
    await expect.poll(() => reply.textContent().then((text) => text!.length)).toBeGreaterThan(1000);
    await conversation.press("End");
    await expect(page.locator("#stop")).toBeVisible();
    expect(await conversation.evaluate((node) => node.scrollTop)).toBeGreaterThan(100);
    await conversation.hover();
    await conversation.evaluate((node) => node.addEventListener("wheel", () => {
      node.dataset.wheelTop = String(node.scrollTop);
    }, { once: true }));
    await page.mouse.wheel(0, -40);
    await expect.poll(() => conversation.evaluate((node) => node.scrollTop - Number(node.dataset.wheelTop))).toBeLessThan(-10);
    const readingTop = await conversation.evaluate((node) => node.scrollTop), textLength = (await reply.textContent())!.length;
    await page.evaluate(() => window.quickChat.invoke("snapshot"));
    await expect.poll(() => reply.textContent().then((text) => text!.length)).toBeGreaterThan(textLength + 600);
    expect(await conversation.evaluate((node) => node.scrollTop)).toBeCloseTo(readingTop, 0);
    // Returning to the bottom explicitly resumes following the rest of the reply.
    await conversation.press("End");
    await expect.poll(() => conversation.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(3);
    await expect(page.locator("#stop")).toBeHidden();
    expect(await conversation.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(3);
    expect(JSON.stringify(api.requests.at(-1)?.messages)).toContain("zpi.environment");
    expect(JSON.stringify(api.requests.at(-1)?.messages)).toContain(dir);
    await page.evaluate(() => window.quickChat.invoke("reset"));
    expect(errors).toEqual([]);
  } finally {
    if (application) {
      const process = application.process();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          application.close(),
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              process.kill("SIGKILL");
              resolve();
            }, 10000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    await api.close();
    await rm(dir, { recursive: true, force: true });
  }
});
