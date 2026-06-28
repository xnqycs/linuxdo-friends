import type { BackgroundCommand, BackgroundResponse } from "../shared/types";

export async function sendCommand<T>(command: BackgroundCommand): Promise<BackgroundResponse<T>> {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    return { ok: false, error: "扩展运行环境不可用。" };
  }
  return chrome.runtime.sendMessage(command);
}
