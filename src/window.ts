import type { Display, Rectangle } from "electron";

// Share the default composer width; the expanded frame adds breathing room on each side.
export const windowSizes = {
  compactHeight: 44,
  expandedSideInset: 16,
  minimumExpandedHeight: 360,
  previewWidth: 660,
  previewHeight: 560,
} as const;

export const resizeEdges = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type ResizeEdge = typeof resizeEdges[number];

export function resizedWindowBounds(
  display: Pick<Display, "bounds" | "workArea">,
  start: Rectangle,
  edge: ResizeEdge,
  dx: number,
  dy: number,
): Rectangle {
  start = windowBounds(display, start.width, start.height, start);
  const area = display.workArea,
    minWidth = Math.min(360 + 2 * windowSizes.expandedSideInset, area.width),
    minHeight = Math.min(windowSizes.minimumExpandedHeight, area.height),
    maxWidth = Math.min(1100, area.width),
    clamp = (value: number, min: number, max: number) => Math.round(Math.max(min, Math.min(value, max)));
  let left = start.x, top = start.y, right = left + start.width, bottom = top + start.height;
  if (edge.includes("w")) left = clamp(left + dx, Math.max(area.x, right - maxWidth), right - minWidth);
  if (edge.includes("e")) right = clamp(right + dx, left + minWidth, Math.min(area.x + area.width, left + maxWidth));
  if (edge.includes("n")) top = clamp(top + dy, area.y, bottom - minHeight);
  if (edge.includes("s")) bottom = clamp(bottom + dy, top + minHeight, area.y + area.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function defaultWindowSize(display: Pick<Display, "workArea">) {
  const { width, height } = display.workArea;
  const round = (value: number) => Math.round(value / 4) * 4;
  return {
    width: Math.min(width, round(Math.max(360, Math.min(440, width * 0.26)))),
    expandedHeight: Math.min(height, round(Math.max(420, Math.min(560, height * 0.56)))),
    bottomGap: Math.round(Math.max(40, Math.min(64, height * 0.06)) / 2) * 2,
  };
}

export function windowBounds(
  display: Pick<Display, "bounds" | "workArea">,
  width: number,
  height: number,
  position?: Rectangle,
  inputInset = 0,
  bottomGap?: number,
): Rectangle {
  const area = display.workArea,
    bottomInset = Math.max(0, display.bounds.y + display.bounds.height - area.y - area.height),
    gap = bottomGap ?? (bottomInset > 4 ? bottomInset : 64);
  width = Math.min(width, area.width);
  height = Math.min(height, area.height);
  return {
    width,
    height,
    x: Math.round(Math.max(area.x, Math.min(
      position ? position.x + (position.width - width) / 2 : area.x + (area.width - width) / 2,
      area.x + area.width - width,
    ))),
    // Align the composer's bottom center, accounting for the expanded window's padding.
    y: Math.round(Math.max(area.y, Math.min(
      (position ? position.y + position.height : area.y + area.height - gap) + inputInset - height,
      area.y + area.height - height,
    ))),
  };
}
