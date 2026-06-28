import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppState } from "../domain/defaultState";
import { resetRuntimeObserversForTest } from "../state/atoms";
import { createMockStorage } from "../test/mockStorage";
import { OptionsApp } from "./main";

describe("OptionsApp update diagnostics", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeObserversForTest();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("shows the installed version and highlights a newer latest release", async () => {
    const chromeMock = setupChrome({
      updateCheck: {
        installedVersion: "1.0.0",
        latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
        status: "update-available",
        latestVersion: "1.1.0",
        checkedAt: "2026-06-28T00:00:00.000Z",
        source: "github_release"
      }
    });
    const { container } = await renderOptionsApp();

    expect(container.querySelector(".version-current")?.textContent).toBe("v1.0.0");
    expect(container.querySelector<HTMLAnchorElement>(".version-github-link")?.href).toBe("https://github.com/LeUKi/linuxdo-friends");
    expect(container.querySelector(".version-update-link")?.textContent).toContain("新 v1.1.0");
    expect(container.textContent).toContain("发现新版本");
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "checkForUpdates", force: undefined });
  });

  it("shows update-check diagnostics on the options page", async () => {
    setupChrome({
      updateCheck: {
        installedVersion: "1.0.0",
        latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
        status: "error",
        checkedAt: "2026-06-28T00:00:00.000Z",
        error: "GitHub Release 检查失败：HTTP 403",
        source: "github_release"
      }
    });
    const { container } = await renderOptionsApp();

    expect(container.textContent).toContain("检查失败");
    expect(container.textContent).toContain("GitHub Release 检查失败：HTTP 403");
  });

  it("forces an update check from the options page", async () => {
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp();

    await act(async () => {
      getButton(container, "检查更新").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "checkForUpdates", force: true });
  });

  it("identifies the current account from the options page", async () => {
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp();

    await act(async () => {
      getButton(container, "重新识别账号").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "identifyCurrentAccount" });
  });

  it("clears cache without confirmation from the options page", async () => {
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp();

    await act(async () => {
      getButton(container, "清理缓存").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "clearCache" });
  });

  it("fully resets only after confirmation from the options page", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp();

    await act(async () => {
      getButton(container, "全量重置").click();
    });

    expect(window.confirm).toHaveBeenCalled();
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "resetExtension" });
  });
});

async function renderOptionsApp() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(OptionsApp));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return { container: host, root };
}

function setupChrome({
  updateCheck = {
    installedVersion: "1.0.0",
    latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
    status: "up-to-date" as const,
    latestVersion: "1.0.0",
    checkedAt: "2026-06-28T00:00:00.000Z",
    source: "github_release" as const
  }
}: {
  updateCheck?: {
    installedVersion: string;
    latestReleaseUrl: string;
    status: "idle" | "checking" | "up-to-date" | "update-available" | "no-release" | "error";
    latestVersion?: string;
    checkedAt?: string;
    error?: string;
    source?: "github_release";
  };
} = {}) {
  const storageListeners: Array<(changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void> = [];
  const sendMessage = vi.fn(async (message) => {
    if (message.type === "getState") return { ok: true, data: defaultAppState };
    if (message.type === "getUpdateCheck") return { ok: true, data: updateCheck };
    if (message.type === "checkForUpdates") return { ok: true, data: updateCheck };
    if (message.type === "identifyCurrentAccount") {
      return {
        ok: true,
        data: {
          ...defaultAppState,
          currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" }
        }
      };
    }
    if (message.type === "clearCache") return { ok: true, data: defaultAppState };
    if (message.type === "resetExtension") return { ok: true, data: defaultAppState };
    if (message.type === "updateSettings") return { ok: true, data: defaultAppState };
    return { ok: false, error: "unexpected command" };
  });
  vi.stubGlobal("chrome", {
    storage: {
      local: createMockStorage({}),
      onChanged: {
        addListener: vi.fn((callback) => {
          storageListeners.push(callback);
        })
      }
    },
    runtime: {
      sendMessage,
      getManifest: vi.fn(() => ({ version: "1.0.0" }))
    }
  });
  return {
    sendMessage,
    emitStorageChange(changes: Record<string, chrome.storage.StorageChange>, areaName = "local") {
      for (const listener of storageListeners) listener(changes, areaName);
    }
  };
}

function getButton(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}
