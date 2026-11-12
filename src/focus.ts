import { createRequire as createNativeRequire } from "node:module";
import { join } from "node:path";

export function macQuickChatFocusWatch(
  directory: string,
  visible: () => boolean,
  onOutside: () => void,
  onError: (error: unknown) => void,
  load: (path: string) => unknown = createNativeRequire(import.meta.url),
): { reset(): void; stop(): void } {
  let timer: ReturnType<typeof setInterval> | undefined;
  let read: (() => number) | undefined;
  let last = 0;
  const stop = () => { clearInterval(timer); read = undefined; };
  const reset = () => {
    try { if (read) last = read(); }
    catch (error) { stop(); onError(error); }
  };
  try {
    const binding = load(join(directory, "quick-chat-focus.node")) as { focusLossCount(): number };
    if (typeof binding?.focusLossCount !== "function") throw new Error("Invalid native focus watcher");
    read = () => binding.focusLossCount();
    last = read();
    timer = setInterval(() => {
      if (!visible() || !read) return;
      try {
        const next = read();
        if (next === last) return;
        last = next;
        onOutside();
      } catch (error) { stop(); onError(error); }
    }, 100);
    timer.unref();
  } catch (error) { stop(); onError(error); }
  return { reset, stop };
}

export function macQuickChatFocus(
  directory: string,
  fallback: () => void,
  onError: (error: unknown) => void,
  load: (path: string) => unknown = createNativeRequire(import.meta.url),
): () => (() => void) | undefined {
  let binding: { activate(): unknown } | null | undefined;
  return () => {
    if (binding !== null) {
      try {
        binding ??= load(join(directory, "quick-chat-focus.node")) as typeof binding;
        if (!binding || typeof binding.activate !== "function")
          throw new Error("Invalid native focus module");
        const restore = binding.activate();
        if (restore !== undefined && typeof restore !== "function")
          throw new Error("Invalid native focus owner");
        return restore as (() => void) | undefined;
      } catch (error) {
        binding = null;
        onError(error);
      }
    }
    fallback();
  };
}
