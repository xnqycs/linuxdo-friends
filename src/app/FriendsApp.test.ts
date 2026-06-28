import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addFriendFromProfile } from "../domain/friends";
import { defaultAppState } from "../domain/defaultState";
import { createMockStorage } from "../test/mockStorage";
import { SITE_DATA_PROGRESS_STORAGE_KEY } from "../storage/siteDataProgressStorage";
import { uiSceneStorageKeys } from "../storage/uiSceneStorage";
import { resetRuntimeObserversForTest } from "../state/atoms";
import { resetUiSceneObserverForTest } from "../state/uiSceneAtoms";
import type { SiteDataTaskProgress } from "../shared/types";
import { eventHappenedInside } from "./FriendsApp";
import { FriendsApp } from "./FriendsApp";

describe("eventHappenedInside", () => {
  it("uses composedPath so shadow-dom retargeted events still count as inside", () => {
    const popover = document.createElement("div");
    const input = document.createElement("input");
    const host = document.createElement("div");
    popover.append(input);
    document.body.append(popover, host);

    const event = new PointerEvent("pointerdown");
    Object.defineProperty(event, "target", { value: host });
    Object.defineProperty(event, "composedPath", { value: () => [input, popover, host, document.body, document] });

    expect(eventHappenedInside(event, popover)).toBe(true);
  });

  it("falls back to target containment when composedPath is empty", () => {
    const popover = document.createElement("div");
    const input = document.createElement("input");
    popover.append(input);
    document.body.append(popover);

    const event = new PointerEvent("pointerdown");
    Object.defineProperty(event, "target", { value: input });
    Object.defineProperty(event, "composedPath", { value: () => [] });

    expect(eventHappenedInside(event, popover)).toBe(true);
  });

  it("treats events outside the popover as outside", () => {
    const popover = document.createElement("div");
    const outside = document.createElement("button");
    document.body.append(popover, outside);

    const event = new PointerEvent("pointerdown");
    Object.defineProperty(event, "target", { value: outside });
    Object.defineProperty(event, "composedPath", { value: () => [outside, document.body, document] });

    expect(eventHappenedInside(event, popover)).toBe(false);
  });
});

describe("FriendsApp UI scene persistence", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeObserversForTest();
    resetUiSceneObserverForTest();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("restores tab, modal query, and filter popover scene from session storage", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed",
      [uiSceneStorageKeys.addFriendModalOpen]: true,
      [uiSceneStorageKeys.addFriendQuery]: "neo",
      [uiSceneStorageKeys.activityKindPopoverOpen]: true,
      [uiSceneStorageKeys.activityKindPopoverQuery]: "bo"
    });
    setupChrome({ session });
    const { container } = await renderFriendsApp();

    expect(container.textContent).toContain("暂无匹配动态");
    expect(container.querySelector<HTMLInputElement>(".modal-search-input")?.value).toBe("neo");
    expect(container.querySelector<HTMLInputElement>(".filter-popover-menu input")?.value).toBe("bo");
  });

  it("persists tab and modal query changes to session storage", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    setupChrome({ session });
    const { container } = await renderFriendsApp();

    await act(async () => {
      getButton(container, "我的佬").click();
    });
    await act(async () => {
      getButton(container, "佬友圈").click();
    });
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>(".modal-search-input");
      input?.focus();
      setInputValue(input!, "neo");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    expect(session.dump()).toMatchObject({
      [uiSceneStorageKeys.tab]: "feed",
      [uiSceneStorageKeys.addFriendModalOpen]: true,
      [uiSceneStorageKeys.addFriendQuery]: "neo"
    });
  });

  it("resets a stale restored user filter to all", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed",
      [uiSceneStorageKeys.feedUserFilter]: "ghost"
    });
    setupChrome({ session });
    await renderFriendsApp();

    expect(session.dump()).toMatchObject({
      [uiSceneStorageKeys.feedUserFilter]: "all"
    });
  });

  it("renders reply activity kind cards as narrow stacked controls", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed"
    });
    setupChrome({
      session,
      state: {
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
        activity: {
          neo: {
            username: "neo",
            refreshedAt: "2026-06-28T00:05:00.000Z",
            items: [
              {
                id: "reply:neo:1",
                username: "neo",
                kind: "reply",
                title: "回复目标",
                url: "/t/topic/1/3",
                occurredAt: "2026-06-28T00:04:00.000Z",
                excerpt: "回复内容",
                replyToPostNumber: 3
              }
            ]
          }
        }
      }
    });
    const { container } = await renderFriendsApp();

    const kindCard = container.querySelector<HTMLAnchorElement>(".kind-card.kind-reply");
    expect(kindCard?.querySelector(".kind-card-icon svg")).toBeTruthy();
    expect(kindCard?.querySelector(".kind-card-label")?.textContent).toBe("回复");
    expect(kindCard?.querySelector(".kind-card-floor")?.textContent).toBe("#3");
    expect(kindCard?.querySelector(".kind-card-link svg")).toBeTruthy();
  });

  it("shows running refresh progress in the in-page friends view", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "friends"
    });
    setupChrome({
      session,
      progress: {
        taskId: "profiles-1",
        taskType: "profiles",
        usernames: ["neo"],
        status: "running",
        completed: 0,
        total: 1,
        currentLabel: "@neo",
        startedAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });
    const { container } = await renderFriendsApp("in-page");

    expect(container.querySelector(".refresh-button-inner.is-running")).toBeTruthy();
    expect(container.querySelector(".refresh-progress-track span")).toBeTruthy();
    expect(container.querySelector(".refresh-button-label")?.textContent).toBe("@neo");
    expect(container.querySelector(".spin-icon")).toBeTruthy();
  });

  it("disables refresh actions while a shared site-data task is running", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "friends"
    });
    setupChrome({
      session,
      progress: {
        taskId: "profiles-1",
        taskType: "profiles",
        usernames: ["neo"],
        status: "running",
        completed: 0,
        total: 1,
        currentLabel: "@neo",
        startedAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });
    const { container } = await renderFriendsApp("in-page");

    expect(getButton(container, "@neo").disabled).toBe(true);
  });

  it("updates in-page refresh progress from shared session state changes", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "friends"
    });
    const chromeMock = setupChrome({ session });
    const { container } = await renderFriendsApp("in-page");

    expect(container.querySelector(".refresh-button-inner.is-running")).toBeFalsy();

    await act(async () => {
      chromeMock.emitStorageChange(
        {
          [SITE_DATA_PROGRESS_STORAGE_KEY]: {
            oldValue: null,
            newValue: {
              taskId: "profiles-live",
              taskType: "profiles",
              usernames: ["neo"],
              status: "running",
              completed: 0,
              total: 1,
              currentLabel: "@neo",
              startedAt: "2026-06-28T00:00:00.000Z",
              updatedAt: "2026-06-28T00:00:00.000Z"
            }
          }
        }
      );
    });

    expect(container.querySelector(".refresh-button-inner.is-running")).toBeTruthy();
    expect(container.querySelector(".refresh-progress-track span")).toBeTruthy();
    expect(container.querySelector(".refresh-button-label")?.textContent).toBe("@neo");
    expect(container.querySelector(".spin-icon")).toBeTruthy();
  });

  it("uses compact side-panel and settings launchers in the in-page header instead of the linked-session tag", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session });
    const { container } = await renderFriendsApp("in-page");

    expect(container.textContent).not.toContain("关联会话");
    const launcher = container.querySelector<HTMLButtonElement>(".side-panel-chip");
    const settings = container.querySelector<HTMLButtonElement>(".settings-chip");
    expect(launcher).toBeTruthy();
    expect(settings).toBeTruthy();

    await act(async () => {
      launcher?.click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "openSidePanel" });

    await act(async () => {
      settings?.click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "openOptionsPage" });
  });

  it("keeps the linked-session tag and settings launcher in the browser side panel surface", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = await renderFriendsAppWithChrome({
      session,
      surface: "side-panel",
      pageStatus: {
        status: "connected",
        connectedCount: 2,
        staleCount: 0,
        heartbeats: [],
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });
    const { container } = chromeMock;

    expect(container.textContent).toContain("关联会话 2");
    expect(container.querySelector(".side-panel-chip")).toBeFalsy();
    expect(container.querySelector(".settings-chip")).toBeTruthy();
  });

  it("shows installed version and triggers an update check when the plugin opens", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.querySelector<HTMLAnchorElement>(".version-github-link")?.href).toBe("https://github.com/LeUKi/linuxdo-friends");
    expect(container.querySelector(".version-current")?.textContent).toBe("v1.0.1");
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "getUpdateCheck" });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "checkForUpdates", force: undefined });
  });

  it("auto-identifies the current account instead of showing a dead local tag", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session, state: defaultAppState });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.textContent).not.toContain("本地优先");
    expect(container.textContent).toContain("@lafish");
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "identifyCurrentAccount" });
  });

  it("keeps a manual identify account button when automatic identification fails", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session, state: defaultAppState, identifyFails: true });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.textContent).not.toContain("本地优先");
    expect(getButton(container, "识别账号")).toBeTruthy();
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "identifyCurrentAccount" });

    await act(async () => {
      getButton(container, "识别账号").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "identifyCurrentAccount" });
  });

  it("highlights a newer version in the main plugin surfaces", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    setupChrome({
      session,
      updateCheck: {
        installedVersion: "1.0.0",
        latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
        status: "update-available",
        latestVersion: "1.1.0",
        checkedAt: "2026-06-28T00:00:00.000Z",
        source: "github_release"
      }
    });
    const { container } = await renderFriendsApp("in-page");

    const link = container.querySelector<HTMLAnchorElement>(".version-update-link");
    expect(link?.textContent).toContain("新 v1.1.0");
    expect(link?.href).toBe("https://github.com/LeUKi/linuxdo-friends/releases/latest");
  });

  it("keeps update-check failures quiet in the main plugin surfaces", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    setupChrome({
      session,
      updateCheck: {
        installedVersion: "1.0.0",
        latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
        status: "error",
        checkedAt: "2026-06-28T00:00:00.000Z",
        error: "GitHub Release 检查失败：HTTP 403",
        source: "github_release"
      }
    });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.querySelector(".version-current")?.textContent).toBe("v1.0.0");
    expect(container.querySelector(".version-update-link")).toBeFalsy();
    expect(container.textContent).not.toContain("GitHub Release 检查失败");
  });

  it("opens the options page from the browser side panel surface", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({
      session,
      pageStatus: {
        status: "connected",
        connectedCount: 2,
        staleCount: 0,
        heartbeats: [],
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });
    const { container } = await renderFriendsApp("side-panel");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".settings-chip")?.click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "openOptionsPage" });
  });
});

async function renderFriendsApp(surface?: React.ComponentProps<typeof FriendsApp>["surface"]) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(FriendsApp, surface ? { surface } : undefined));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return { container: host, root };
}

async function renderFriendsAppWithChrome({
  session,
  surface,
  pageStatus
}: {
  session: ReturnType<typeof createMockStorage>;
  surface?: React.ComponentProps<typeof FriendsApp>["surface"];
  pageStatus: Parameters<typeof setupChrome>[0]["pageStatus"];
}) {
  setupChrome({ session, pageStatus });
  return renderFriendsApp(surface);
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
}

function setupChrome({
  pageStatus = { status: "missing", connectedCount: 0, staleCount: 0, heartbeats: [], updatedAt: new Date(0).toISOString() },
  progress = null,
  session,
  state = addFriendFromProfile(defaultAppState, {
    username: "neo",
    name: "Neo",
    refreshedAt: "2026-06-28T00:00:00.000Z"
  }),
  identifyFails = false,
  updateCheck = {
    installedVersion: "1.0.1",
    latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
    status: "up-to-date" as const,
    latestVersion: "1.0.1",
    checkedAt: "2026-06-28T00:00:00.000Z",
    source: "github_release" as const
  }
}: {
  pageStatus?: {
    status: "connected" | "challenge" | "stale" | "missing";
    connectedCount: number;
    staleCount: number;
    heartbeats: [];
    updatedAt: string;
  };
  progress?: SiteDataTaskProgress | null;
  session: ReturnType<typeof createMockStorage>;
  state?: typeof defaultAppState;
  identifyFails?: boolean;
  updateCheck?: {
    installedVersion: string;
    latestReleaseUrl: string;
    status: "idle" | "checking" | "up-to-date" | "update-available" | "no-release" | "error";
    latestVersion?: string;
    checkedAt?: string;
    error?: string;
    source?: "github_release";
  };
}) {
  const storageListeners: Array<(changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void> = [];
  const sendMessage = vi.fn(async (message) => {
    if (message.type === "getState") return { ok: true, data: state };
    if (message.type === "getPageScriptStatus") {
      return { ok: true, data: pageStatus };
    }
    if (message.type === "getSiteDataProgress") return { ok: true, data: progress };
    if (message.type === "getUpdateCheck") return { ok: true, data: updateCheck };
    if (message.type === "checkForUpdates") return { ok: true, data: updateCheck };
    if (message.type === "identifyCurrentAccount") {
      if (identifyFails) return { ok: false, error: "需要打开 linux.do 后识别。" };
      return {
        ok: true,
        data: {
          ...state,
          currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" }
        }
      };
    }
    if (message.type === "openSidePanel") return { ok: true, data: { message: "已打开插件侧栏。" } };
    if (message.type === "openOptionsPage") return { ok: true, data: { message: "已打开配置页。" } };
    return { ok: true, data: state };
  });
  vi.stubGlobal("chrome", {
    storage: {
      session,
      onChanged: {
        addListener: vi.fn((callback) => {
          storageListeners.push(callback);
        })
      }
    },
    runtime: {
      sendMessage,
      getManifest: vi.fn(() => ({ version: "1.0.1" })),
      onMessage: {
        addListener: vi.fn()
      }
    }
  });
  return {
    sendMessage,
    emitStorageChange(changes: Record<string, chrome.storage.StorageChange>, areaName = "session") {
      for (const listener of storageListeners) listener(changes, areaName);
    }
  };
}

function getButton(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}
