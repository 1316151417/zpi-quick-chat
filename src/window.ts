import type { Display, Rectangle } from "electron";

export function windowBounds(
  display: Pick<Display, "bounds" | "workArea">,
  width: number,
  height: number,
  position?: Rectangle,
  inputInset = 0,
): Rectangle {
  const area = display.workArea,
    bottomInset = Math.max(0, display.bounds.y + display.bounds.height - area.y - area.height),
    gap = bottomInset > 4 ? bottomInset : 64;
  width = Math.min(width, area.width);
  height = Math.min(height, area.height);
  return {
    width,
    height,
    x: Math.round(Math.max(area.x, Math.min(
      position ? position.x + (position.width - width) / 2 : display.bounds.x + (display.bounds.width - width) / 2,
      area.x + area.width - width,
    ))),
    // Align the composer's bottom center, accounting for the expanded window's padding.
    y: Math.round(Math.max(area.y, Math.min(
      (position ? position.y + position.height : area.y + area.height - gap) + inputInset - height,
      area.y + area.height - height,
    ))),
  };
}
