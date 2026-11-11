import { test } from "node:test";
import assert from "node:assert/strict";
import { windowBounds } from "../src/window.ts";

const display = {
  bounds: { x: 0, y: 0, width: 1440, height: 900 },
  workArea: { x: 0, y: 25, width: 1440, height: 825 },
};

test("unmoved windows start centered above the dock", () => {
  assert.deepEqual(windowBounds(display, 360, 44), { x: 540, y: 756, width: 360, height: 44 });
});

test("dragged input stays at its horizontal position and grows upward", () => {
  const moved = { x: 120, y: 500, width: 360, height: 44 };
  const taller = windowBounds(display, 360, 184, moved);
  assert.deepEqual(taller, { x: 120, y: 360, width: 360, height: 184 });
  assert.deepEqual(windowBounds(display, 360, 44, taller), moved);
});

test("both window modes share a bottom center and dragging either moves the other", () => {
  const compact = { x: 400, y: 700, width: 360, height: 44 },
    expanded = windowBounds(display, 660, 560, compact);
  assert.deepEqual(expanded, { x: 250, y: 184, width: 660, height: 560 });
  assert.deepEqual(windowBounds(display, 360, 44, expanded), compact);
  assert.deepEqual(windowBounds(display, 360, 44, { ...expanded, x: 300, y: 150 }),
    { x: 450, y: 666, width: 360, height: 44 });
});

test("remembered positions stay visible after a display is removed or resized", () => {
  assert.deepEqual(windowBounds(display, 660, 560, { x: -1200, y: 300, width: 660, height: 560 }),
    { x: 0, y: 290, width: 660, height: 560 });
  const small = {
    bounds: { x: -500, y: -400, width: 500, height: 400 },
    workArea: { x: -500, y: -375, width: 500, height: 375 },
  };
  assert.deepEqual(windowBounds(small, 660, 560, { x: 100, y: 200, width: 660, height: 560 }),
    { x: -500, y: -375, width: 500, height: 375 });
});
