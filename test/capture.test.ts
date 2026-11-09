import { test } from "node:test";
import assert from "node:assert/strict";
import { QuickChatCapture } from "../src/capture.ts";
import { macQuickChatCapture } from "../src/mac-capture.ts";
test("repeated capture joins one operation and reset rejects stale drafts", async () => {
  let session = "one",
    reads = 0,
    deliveries = 0;
  const pending = Promise.withResolvers<{ text: string }>();
  const capture = new QuickChatCapture({
    sessionId: () => session,
    hide: () => {},
    read: () => {
      reads++;
      return pending.promise;
    },
    open: async () => {
      deliveries++;
    },
  });
  const first = capture.invoke("selection"),
    second = capture.invoke("selection");
  session = "two";
  pending.resolve({ text: "Copied" });
  await Promise.all([first, second]);
  assert.equal(reads, 1);
  assert.equal(deliveries, 0);
  capture.dispose();
});
test("isolated capture refuses native OS access", () => {
  const read = macQuickChatCapture({
    platform: "darwin",
    testMode: true,
    temporaryDirectory: "/unused",
    copyHelper: "/unused",
    clipboard: {} as never,
    accessibilityAccess: () => {
      throw new Error("OS accessed");
    },
  });
  assert.throws(() => read("selection", new AbortController().signal), /unavailable/);
});
test("selection helper output is only a draft and requires an explicit successful copy", async () => {
  let reads = 0;
  const read = macQuickChatCapture({
    platform: "darwin",
    testMode: false,
    temporaryDirectory: "/unused",
    copyHelper: "/synthetic/helper",
    clipboard: {} as never,
    accessibilityAccess: () => true,
    run: async () => {
      reads++;
      return { stdout: JSON.stringify({ copied: true, text: "Translate me" }) };
    },
  });
  assert.deepEqual(await read("selection", new AbortController().signal), { text: "Translate me" });
  assert.equal(reads, 1);
});

for (const invalidate of ["reset", "dispose"] as const) {
  test(`late capture failure is ignored after ${invalidate}`, async () => {
    const pending = Promise.withResolvers<never>();
    let session = "one",
      delivered = false;
    const capture = new QuickChatCapture({
      sessionId: () => session,
      hide: () => {},
      read: () => pending.promise,
      open: async () => {
        delivered = true;
      },
    });
    const first = capture.invoke("selection");
    if (invalidate === "reset") session = "two";
    else capture.dispose();
    pending.reject(new Error("late native failure"));
    await first;
    assert.equal(delivered, false);
    capture.dispose();
  });
}
test("current capture failures still reach the caller", async () => {
  const capture = new QuickChatCapture({
    sessionId: () => "one",
    hide: () => {},
    read: async () => {
      throw new Error("native failure");
    },
    open: async () => {},
  });
  await assert.rejects(capture.invoke("selection"), /native failure/);
  capture.dispose();
});
test("a new session can capture immediately while the old selection is still pending", async () => {
  let session = "one",
    oldSignal: AbortSignal | undefined;
  const pending = Promise.withResolvers<{ text: string }>();
  const drafts: string[] = [];
  const capture = new QuickChatCapture({
    sessionId: () => session,
    hide: () => {},
    read: (kind, signal) => {
      if (kind === "selection") {
        oldSignal = signal;
        return pending.promise;
      }
      return { text: "New clipboard" };
    },
    open: async (draft) => { drafts.push(draft.text!); },
  });
  const old = capture.invoke("selection");
  session = "two";
  await capture.invoke("clipboard");
  assert.equal(oldSignal?.aborted, true);
  pending.resolve({ text: "Old selection" });
  await old;
  assert.deepEqual(drafts, ["New clipboard"]);
  capture.dispose();
});
