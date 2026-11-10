import { test, expect, _electron as electron } from "@playwright/test";
import { cp, mkdtemp, rm } from "node:fs/promises";
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
    await expect(page.locator("body")).not.toHaveClass("expanded");
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
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("#composer")).toHaveCSS("background-color", "rgb(43, 43, 43)");
    await page.screenshot({ path: test.info().outputPath("compact-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
    await input.fill("一\n二\n三");
    await expect.poll(size).toEqual({ width: 360, height: 88 });
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
      await page.getByRole("button", { name: `预览 ${picture.name}`, exact: true }).click();
      await expect(viewer).toBeVisible();
      await expect.poll(size).toEqual({ width: 660, height: 560 });
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
      await expect(input).toHaveValue("预览前的草稿\n第二行\n第三行");
      await expect(page.locator("#images img")).toHaveCount(2);
    }
    await input.fill("Translate hello");
    await input.evaluate((node) => {
      for (let index = 0; index < 2; index++)
        node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await expect(page.locator(".assistant .message-text")).toContainText("你");
    await expect(page.locator("#stop")).toBeVisible();
    await expect(page.locator(".assistant")).toContainText("你好，世界");
    await expect(page.getByRole("button", { name: "复制" })).toBeVisible();
    await expect(page.locator("#stop")).toBeHidden();
    expect(api.requests).toHaveLength(1);
    await expect.poll(size).toEqual({ width: 660, height: 560 });
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
    await page.locator(".assistant .message-text").evaluate((node) => {
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
    expect(JSON.stringify(api.requests[0].messages)).toContain("常规问题不超过3句话");
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
    await page.evaluate(() => window.quickChat.invoke("reset"));
    await expect(viewer).toBeHidden();
    await expect.poll(size).toEqual({ width: 360, height: 44 });
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
