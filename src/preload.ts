import { contextBridge, ipcRenderer } from "electron";
import type { Bridge } from "./types.ts";
const bridge: Bridge = {
  invoke: (action, input) => ipcRenderer.invoke("quick-chat:action", action, input),
  onText: (callback) => {
    const listener = (_: unknown, value: Parameters<typeof callback>[0]) => callback(value);
    ipcRenderer.on("quick-chat:text", listener);
    return () => ipcRenderer.removeListener("quick-chat:text", listener);
  },
  onSnapshot: (callback) => {
    const listener = (_: unknown, value: Parameters<typeof callback>[0]) => callback(value);
    ipcRenderer.on("quick-chat:snapshot", listener);
    return () => ipcRenderer.removeListener("quick-chat:snapshot", listener);
  },
  onDraft: (callback) => {
    const listener = (_: unknown, value: Parameters<typeof callback>[0]) => callback(value);
    ipcRenderer.on("quick-chat:draft", listener);
    return () => ipcRenderer.removeListener("quick-chat:draft", listener);
  },
};
contextBridge.exposeInMainWorld("quickChat", bridge);
