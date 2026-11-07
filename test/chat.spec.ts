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
    api = await server();
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
    await page.locator("#files").setInputFiles({
      name: "one.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWP4z8AAQVDqPwMDAEHSBfsYFwTiAAAAAElFTkSuQmCC",
        "base64",
      ),
    });
    await expect(page.locator("#images img")).toHaveCount(1);
    await input.fill("Translate hello");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.locator(".assistant")).toContainText("你好，世界");
    await expect(page.locator("#stop")).toBeHidden();
    await input.fill("Continue");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.locator(".assistant").last()).toContainText("继续对话");
    expect(JSON.stringify(api.requests[0].messages)).toContain("image_url");
    expect(JSON.stringify(api.requests[1].messages)).toContain("Translate hello");
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
    await page.getByTitle("新建对话 ⌥⇧Space").click();
    await expect(page.locator(".message")).toHaveCount(0);
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
    await page.locator("#files").setInputFiles([file("old-a.png"), file("old-b.png")]);
    await expect.poll(readerCount).toBe(1);
    await page.evaluate(() => window.quickChat.invoke("reset"));
    await releaseImage(0);
    await expect(page.locator("#images img")).toHaveCount(0);
    expect(await readerCount()).toBe(1);

    await page.locator("#files").setInputFiles([file("a.png"), file("b.png"), file("c.png")]);
    await page.locator("#files").setInputFiles([file("d.png"), file("e.png"), file("f.png")]);
    for (let index = 1; index <= 6; index++) {
      await expect.poll(readerCount).toBeGreaterThan(index);
      await releaseImage(index);
    }
    await expect(page.locator("#images img")).toHaveCount(4);
    await expect(page.locator("#error")).toContainText("最多带入 4 张图片");
    await page.evaluate(() => window.quickChat.invoke("reset"));
    await page.locator("#files").setInputFiles(file("cannot-read.png"));
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
