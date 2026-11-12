// Match ZPI's packages/ui/src/components/InputNotice.tsx.
export const errorNoticeTiming = { text: 3000, badge: 8000, leave: 100 } as const;

export function createErrorNotice(render: (message: string, details: boolean) => void) {
  let message = "";
  let automatic = false, hovered = false, focused = false, expired = false;
  let textTimer: ReturnType<typeof setTimeout> | undefined;
  let badgeTimer: ReturnType<typeof setTimeout> | undefined;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(textTimer); clearTimeout(badgeTimer); clearTimeout(leaveTimer); };
  const clear = () => {
    cancel(); message = ""; automatic = hovered = focused = expired = false;
    render("", false);
  };
  const update = () => {
    if (expired && !hovered && !focused) { clear(); return; }
    render(message, Boolean(message) && (automatic || hovered || focused));
  };
  const show = (value: unknown) => {
    cancel();
    message = (value instanceof Error ? value.message : String(value ?? "")).trim();
    automatic = true;
    hovered = focused = expired = false;
    update();
    if (!message) return;
    textTimer = setTimeout(() => { automatic = false; update(); }, errorNoticeTiming.text);
    badgeTimer = setTimeout(() => { expired = true; update(); }, errorNoticeTiming.badge);
  };
  return {
    show, clear,
    setHovered(value: boolean) {
      clearTimeout(leaveTimer);
      if (value) { hovered = true; update(); }
      else leaveTimer = setTimeout(() => { hovered = false; update(); }, errorNoticeTiming.leave);
    },
    setFocused(value: boolean) { focused = value; update(); },
    dismissDetails() { clearTimeout(leaveTimer); automatic = hovered = focused = false; update(); },
  };
}
