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

  it("exports config from the options page", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:config");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp();

    await act(async () => {
      getButton(container, "导出配置").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "exportConfig" });
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:config");
    expect(container.textContent).toContain("已导出 1 位佬朋友配置。");
  });

  it("imports config from the options page after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("import input not found");
    const file = new File(["{}"], "config.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(window.confirm).toHaveBeenCalled();
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "importConfig", json: "{}" });
    expect(container.textContent).toContain("已导入 1 位佬朋友配置。");
  });

  it("checks cloud config status once on open without restoring config", async () => {
    const chromeMock = setupChrome({
      cloudState: {
        binding: {
          bound: true,
          app: "linuxdo-friends",
          linuxDoId: "42",
          tokenType: "Bearer",
          tokenKind: "jwt",
          boundAt: "2026-06-29T00:00:00.000Z"
        },
        status: {
          state: "remote_config",
          checkedAt: "2026-06-29T00:01:00.000Z",
          exportedAt: "2026-06-29T00:00:00.000Z",
          friendCount: 1
        },
        message: "云端配置：1 位佬朋友。"
      }
    });
    const { container } = await renderOptionsApp();

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "getCloudConfigStatus" });
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({ type: "restoreCloudConfig" });
    expect(container.textContent).toContain("已绑定 linuxdo-cloud-save");
    expect(container.textContent).toContain("云端配置：1 位佬朋友");
    expect(container.textContent).toContain("绑定账号 ID：42");
    expect(container.textContent).not.toContain("chromiumapp.org");
    expect(container.textContent).not.toContain("secret-token");
  });

  it("binds and backs up cloud config from the options page", async () => {
    const chromeMock = setupChrome({ cloudState: { binding: { bound: false }, message: "尚未绑定 linuxdo-cloud-save。" } });
    const { container } = await renderOptionsApp();

    await act(async () => {
      getButton(container, "绑定").click();
    });
    await act(async () => {
      getButton(container, "备份到云端").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "bindCloudSave" });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "backupCloudConfig" });
    expect(container.textContent).toContain("已备份 1 位佬朋友到云端。");
    expect(container.textContent).not.toContain("secret-token");
  });

  it("restores cloud config only after confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const chromeMock = setupChrome({ cloudState: boundCloudState() });
    const { container } = await renderOptionsApp();

    await act(async () => {
      getButton(container, "从云端恢复").click();
    });

    expect(confirm).toHaveBeenCalled();
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({ type: "restoreCloudConfig" });

    confirm.mockReturnValue(true);
    await act(async () => {
      getButton(container, "从云端恢复").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "restoreCloudConfig" });
    expect(container.textContent).toContain("已导入 1 位佬朋友配置。");
  });

  it("disconnects cloud binding without changing local config UI", async () => {
    const chromeMock = setupChrome({ cloudState: boundCloudState() });
    const { container } = await renderOptionsApp();

    await act(async () => {
      getButton(container, "断开绑定").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "clearCloudBinding" });
    expect(container.textContent).toContain("已断开云存档绑定。");
  });

  it("shows the feed background refresh placeholder without enabling durable auto refresh", async () => {
    const { container } = await renderOptionsApp();

    expect(container.textContent).toContain("佬友圈后台刷新");
    expect(container.textContent).toContain("webhook");
    expect(container.textContent).toContain("规则匹配");
    expect(container.textContent).toContain("本版本只保留入口");
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
  });

  it("updates the activity navigation setting from the options page", async () => {
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp();
    const toggle = inputByLabelText(container, "在当前 linux.do 页面内打开动态");

    await act(async () => {
      toggle.click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "updateSettings",
      settings: { openActivityLinksInPage: true }
    });
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
  },
  cloudState = { binding: { bound: false as const }, status: { state: "unchecked" as const }, message: "尚未绑定 linuxdo-cloud-save。" }
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
  cloudState?: Record<string, unknown>;
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
    if (message.type === "exportConfig") {
      return {
        ok: true,
        data: {
          schemaVersion: 1,
          source: "linuxdo-friends",
          exportedAt: "2026-06-28T00:00:00.000Z",
          friends: {
            neo: {
              username: "neo",
              note: "",
              groups: [],
              pinned: false,
              upgradedAt: "2026-06-28T00:00:00.000Z",
              updatedAt: "2026-06-28T00:00:00.000Z"
            }
          },
          settings: defaultAppState.settings
        }
      };
    }
    if (message.type === "importConfig") {
      return {
        ok: true,
        data: {
          ...defaultAppState,
          friends: {
            neo: {
              username: "neo",
              note: "",
              groups: [],
              pinned: false,
              upgradedAt: "2026-06-28T00:00:00.000Z",
              updatedAt: "2026-06-28T00:00:00.000Z"
            }
          },
          lastSync: { ok: true, source: "manual", message: "已导入 1 位佬朋友配置。", refreshedAt: "2026-06-28T00:00:00.000Z" }
        }
      };
    }
    if (message.type === "getCloudConfigStatus") return { ok: true, data: cloudState };
    if (message.type === "bindCloudSave") return { ok: true, data: boundCloudState("已绑定 linuxdo-cloud-save。") };
    if (message.type === "backupCloudConfig") {
      return {
        ok: true,
        data: {
          ...boundCloudState("已备份 1 位佬朋友到云端。"),
          status: { state: "remote_config", checkedAt: "2026-06-29T00:02:00.000Z", exportedAt: "2026-06-29T00:00:00.000Z", friendCount: 1 }
        }
      };
    }
    if (message.type === "restoreCloudConfig") {
      return {
        ok: true,
        data: {
          ...boundCloudState("已导入 1 位佬朋友配置。"),
          state: {
            ...defaultAppState,
            friends: {
              neo: {
                username: "neo",
                note: "",
                groups: [],
                pinned: false,
                activityKinds: ["topic", "reply", "boost", "reaction"],
                upgradedAt: "2026-06-29T00:00:00.000Z",
                updatedAt: "2026-06-29T00:00:00.000Z"
              }
            },
            lastSync: { ok: true, source: "manual", message: "已导入 1 位佬朋友配置。", refreshedAt: "2026-06-29T00:00:00.000Z" }
          }
        }
      };
    }
    if (message.type === "clearCloudBinding") {
      return { ok: true, data: { binding: { bound: false }, message: "已断开云存档绑定。" } };
    }
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

function inputByLabelText(container: HTMLElement, text: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll("label")).find((candidate) => candidate.textContent?.includes(text));
  const input = label?.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error(`input not found: ${text}`);
  return input;
}

function boundCloudState(message = "云端配置：1 位佬朋友。") {
  return {
    binding: {
      bound: true,
      app: "linuxdo-friends",
      linuxDoId: "42",
      tokenType: "Bearer",
      tokenKind: "jwt",
      boundAt: "2026-06-29T00:00:00.000Z",
      lastBackupAt: "2026-06-29T00:02:00.000Z",
      lastRestoreAt: "2026-06-29T00:03:00.000Z"
    },
    status: {
      state: "remote_config",
      checkedAt: "2026-06-29T00:01:00.000Z",
      exportedAt: "2026-06-29T00:00:00.000Z",
      friendCount: 1
    },
    message
  };
}

function getButton(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}
