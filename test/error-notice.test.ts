import assert from "node:assert/strict";
import { test } from "node:test";
import { createErrorNotice, errorNoticeTiming } from "../src/error-notice.ts";

test("error details disappear before the badge, and the badge can reopen details", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let shown: [string, boolean] = ["", false];
  const notice = createErrorNotice((message, details) => { shown = [message, details]; });
  notice.show(new Error("最多带入 5 张图片"));
  assert.deepEqual(shown, ["最多带入 5 张图片", true]);
  t.mock.timers.tick(errorNoticeTiming.text);
  assert.deepEqual(shown, ["最多带入 5 张图片", false]);
  notice.setHovered(true);
  assert.deepEqual(shown, ["最多带入 5 张图片", true]);
  t.mock.timers.tick(errorNoticeTiming.badge);
  assert.deepEqual(shown, ["最多带入 5 张图片", true]);
  notice.setHovered(false);
  t.mock.timers.tick(errorNoticeTiming.leave);
  assert.deepEqual(shown, ["", false]);
});

test("old timers cannot dismiss a newer error and clearing removes pending notices", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let shown: [string, boolean] = ["", false];
  const notice = createErrorNotice((message, details) => { shown = [message, details]; });
  notice.show("旧错误");
  t.mock.timers.tick(errorNoticeTiming.text - 1);
  notice.show("新错误");
  t.mock.timers.tick(1);
  assert.deepEqual(shown, ["新错误", true]);
  notice.clear();
  t.mock.timers.tick(errorNoticeTiming.badge);
  assert.deepEqual(shown, ["", false]);
  notice.setFocused(true);
  assert.deepEqual(shown, ["", false]);
});

test("focus retains expired details until blur and Escape dismisses only details", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let shown: [string, boolean] = ["", false];
  const notice = createErrorNotice((message, details) => { shown = [message, details]; });
  notice.show("附件太多");
  notice.setFocused(true);
  t.mock.timers.tick(errorNoticeTiming.badge + 1);
  assert.deepEqual(shown, ["附件太多", true]);
  notice.setFocused(false);
  assert.deepEqual(shown, ["", false]);
  notice.show("新错误");
  notice.dismissDetails();
  assert.deepEqual(shown, ["新错误", false]);
  t.mock.timers.tick(errorNoticeTiming.badge);
  assert.deepEqual(shown, ["", false]);
});
