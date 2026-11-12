import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultWindowSize, resizedWindowBounds, windowBounds } from "../src/window.ts";

const display = {
  bounds: { x: 0, y: 0, width: 1440, height: 900 },
  workArea: { x: 0, y: 25, width: 1440, height: 825 },
};

test("edge and corner resizing anchors the opposite sides", () => {
  const start = { x: 400, y: 300, width: 424, height: 500 };
  const expected = {
    n: { x: 400, y: 260, width: 424, height: 540 },
    ne: { x: 400, y: 260, width: 484, height: 540 },
    e: { x: 400, y: 300, width: 484, height: 500 },
    se: { x: 400, y: 300, width: 484, height: 530 },
    s: { x: 400, y: 300, width: 424, height: 530 },
    sw: { x: 432, y: 300, width: 392, height: 530 },
    w: { x: 432, y: 300, width: 392, height: 500 },
    nw: { x: 432, y: 260, width: 392, height: 540 },
  };
  // West edges stop at the minimum width when dragged right by 60px.
  for (const edge of Object.keys(expected) as (keyof typeof expected)[]) {
    assert.deepEqual(resizedWindowBounds(display, start, edge, 60, edge.includes("n") ? -40 : 30), expected[edge]);
  }
});

test("edge resizing respects minimum sizes and screen boundaries", () => {
  const start = { x: 400, y: 300, width: 424, height: 500 };
  assert.deepEqual(resizedWindowBounds(display, start, "nw", 10000, 10000),
    { x: 432, y: 440, width: 392, height: 360 });
  assert.deepEqual(resizedWindowBounds(display, start, "se", 10000, 10000),
    { x: 400, y: 300, width: 1040, height: 550 });
});

test("defaults follow the usable screen size and stay compact on large displays", () => {
  assert.deepEqual(defaultWindowSize({ workArea: { x: 0, y: 38, width: 1512, height: 893 } }),
    { width: 392, expandedHeight: 500, bottomGap: 54 });
  assert.deepEqual(defaultWindowSize({ workArea: { x: 1512, y: 25, width: 1920, height: 1055 } }),
    { width: 440, expandedHeight: 560, bottomGap: 64 });
  assert.deepEqual(defaultWindowSize({ workArea: { x: -800, y: 25, width: 800, height: 575 } }),
    { width: 360, expandedHeight: 420, bottomGap: 40 });
  assert.deepEqual(defaultWindowSize({ workArea: { x: 0, y: 0, width: 300, height: 300 } }),
    { width: 300, expandedHeight: 300, bottomGap: 40 });
});

test("initial placement uses the work area's center and keeps the composer anchored", () => {
  const screen = { bounds: { x: 0, y: 0, width: 1512, height: 982 },
    workArea: { x: 0, y: 38, width: 1512, height: 893 } };
  const compact = windowBounds(screen, 392, 44, undefined, 0, 54);
  assert.deepEqual(compact, { x: 560, y: 833, width: 392, height: 44 });
  const expanded = windowBounds(screen, 424, 500, compact, 13, 54);
  assert.deepEqual(expanded, { x: 544, y: 390, width: 424, height: 500 });
});

test("moving to another screen preserves dimensions and clamps only when needed", () => {
  const external = { bounds: { x: 1512, y: 0, width: 1920, height: 1080 },
    workArea: { x: 1512, y: 25, width: 1920, height: 1055 } };
  const dragged = { x: 1700, y: 300, width: 424, height: 500 };
  assert.deepEqual(windowBounds(external, dragged.width, dragged.height, dragged), dragged);
  const small = { bounds: { x: -400, y: 0, width: 400, height: 400 },
    workArea: { x: -400, y: 25, width: 400, height: 375 } };
  assert.deepEqual(windowBounds(small, dragged.width, dragged.height, dragged),
    { x: -400, y: 25, width: 400, height: 375 });
});

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

test("expanded composer padding does not offset the reopened input bar", () => {
  const compact = { x: 400, y: 700, width: 360, height: 44 },
    inset = 13,
    expanded = windowBounds(display, 660, 560, compact, inset);
  assert.deepEqual(expanded, { x: 250, y: 197, width: 660, height: 560 });
  const moved = { ...expanded, x: 300, y: 150 },
    reopened = windowBounds(display, 360, 44, { ...moved, y: moved.y - inset });
  assert.deepEqual(reopened, { x: 450, y: 653, width: 360, height: 44 });
  assert.equal(reopened.y + reopened.height, moved.y + moved.height - inset);
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
