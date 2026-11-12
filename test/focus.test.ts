import { test } from "node:test";
import assert from "node:assert/strict";
import { macQuickChatFocusWatch } from "../src/focus.ts";

test("native outside events hide without any Electron blur and discard events from before a show", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let events = 0, visible = true, pinned = false, hides = 0;
  const errors: unknown[] = [];
  const watcher = macQuickChatFocusWatch("/unused", () => visible, () => {
    if (!pinned) { hides++; visible = false; }
  }, (error) => errors.push(error), () => ({ focusLossCount: () => events }));
  events++;
  t.mock.timers.tick(100);
  assert.equal(hides, 1);
  events++;
  visible = true;
  watcher.reset();
  t.mock.timers.tick(100);
  assert.equal(hides, 1);
  pinned = true;
  events++;
  t.mock.timers.tick(100);
  assert.equal(hides, 1);
  pinned = false;
  t.mock.timers.tick(100);
  assert.equal(hides, 1, "unpin must not replay old outside events");
  events++;
  t.mock.timers.tick(100);
  assert.equal(hides, 2);
  watcher.stop();
  visible = true;
  events++;
  t.mock.timers.tick(100);
  assert.equal(hides, 2);
  assert.deepEqual(errors, []);
});

test("a failed native watcher reports once and leaves existing focus handling available", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let reads = 0, hides = 0;
  const errors: unknown[] = [];
  const watcher = macQuickChatFocusWatch("/unused", () => true, () => { hides++; },
    (error) => errors.push(error), () => ({ focusLossCount: () => {
      if (++reads > 1) throw new Error("native failure");
      return 0;
    } }));
  t.mock.timers.tick(300);
  watcher.reset();
  watcher.stop();
  assert.equal(errors.length, 1);
  assert.equal(hides, 0);
});
