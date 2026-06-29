import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppState } from "../domain/defaultState";
import { addFriendFromProfile, updateFriend, upsertFollowedUser } from "../domain/friends";
import { isBackgroundCommand } from "../messages/contracts";
import { PAGE_SCRIPT_STATUS_STORAGE_KEY } from "../storage/pageScriptStatusStorage";
import { SITE_DATA_PROGRESS_STORAGE_KEY } from "../storage/siteDataProgressStorage";
import { createMockStorage } from "../test/mockStorage";

describe("message contracts", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("accepts known commands", () => {
    expect(isBackgroundCommand({ type: "lookupFriendProfile", username: "neil" })).toBe(true);
    expect(isBackgroundCommand({ type: "identifyCurrentAccount" })).toBe(true);
    expect(isBackgroundCommand({ type: "addFriendFromKnownUser", user: { username: "neil", name: "Neo" } })).toBe(true);
    expect(
      isBackgroundCommand({
        type: "addFriendFromKnownUser",
        user: { username: "neil" },
        profile: { username: "neil", name: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" }
      })
    ).toBe(true);
    expect(isBackgroundCommand({ type: "addFriendByProfile", username: "neil" })).toBe(true);
    expect(isBackgroundCommand({ type: "updateFriend", username: "neil", patch: { activityKinds: [] } })).toBe(true);
    expect(isBackgroundCommand({ type: "updateFriend", username: "neil", patch: { activityKinds: ["reply", "boost"] } })).toBe(true);
    expect(isBackgroundCommand({ type: "refreshFriendProfiles", usernames: ["neil"] })).toBe(true);
    expect(isBackgroundCommand({ type: "refreshFriendActivity", usernames: ["neil"] })).toBe(true);
    expect(isBackgroundCommand({ type: "refreshFriendActivity", scope: { kind: "boost", usernames: ["neil"] } })).toBe(true);
    expect(isBackgroundCommand({ type: "cacheAvatars", usernames: ["neil"] })).toBe(true);
    expect(isBackgroundCommand({ type: "getSiteDataProgress" })).toBe(true);
    expect(isBackgroundCommand({ type: "getPageScriptStatus" })).toBe(true);
    expect(isBackgroundCommand({ type: "getUpdateCheck" })).toBe(true);
    expect(isBackgroundCommand({ type: "checkForUpdates" })).toBe(true);
    expect(isBackgroundCommand({ type: "checkForUpdates", force: true })).toBe(true);
    expect(isBackgroundCommand({ type: "repairLinuxDoPageScript", tabId: 123 })).toBe(true);
    expect(isBackgroundCommand({ type: "openSidePanel" })).toBe(true);
    expect(isBackgroundCommand({ type: "openOptionsPage" })).toBe(true);
    expect(isBackgroundCommand({ type: "openLinuxDoHome" })).toBe(true);
    expect(isBackgroundCommand({ type: "exportConfig" })).toBe(true);
    expect(isBackgroundCommand({ type: "importConfig", json: "{}" })).toBe(true);
    expect(isBackgroundCommand({ type: "clearCache" })).toBe(true);
    expect(isBackgroundCommand({ type: "resetExtension" })).toBe(true);
  });

  it("rejects unknown commands", () => {
    expect(isBackgroundCommand({ type: "solveCloudflareChallenge" })).toBe(false);
    expect(isBackgroundCommand({ type: "upgradeToFriend", username: "neil" })).toBe(false);
  });

  it("rejects malformed known commands before dispatch", () => {
    expect(isBackgroundCommand({ type: "lookupFriendProfile" })).toBe(false);
    expect(isBackgroundCommand({ type: "addFriendFromKnownUser", user: { name: "No username" } })).toBe(false);
    expect(isBackgroundCommand({ type: "addFriendByProfile" })).toBe(false);
    expect(isBackgroundCommand({ type: "refreshFriendProfiles", usernames: ["ok", ""] })).toBe(false);
    expect(isBackgroundCommand({ type: "cacheAvatars", usernames: ["ok", ""] })).toBe(false);
    expect(isBackgroundCommand({ type: "repairLinuxDoPageScript", tabId: 0 })).toBe(false);
    expect(isBackgroundCommand({ type: "checkForUpdates", force: "yes" })).toBe(false);
    expect(isBackgroundCommand({ type: "refreshFriendActivity", scope: { kind: "bad", usernames: ["ok"] } })).toBe(false);
    expect(isBackgroundCommand({ type: "updateFriend", username: "neil", patch: { activityKinds: ["bad"] } })).toBe(false);
    expect(isBackgroundCommand({ type: "seedFollowedUser", user: { name: "No username" } })).toBe(false);
    expect(isBackgroundCommand({ type: "updateSettings", settings: { refreshIntervalMinutes: 1 } })).toBe(false);
    expect(isBackgroundCommand({ type: "importConfig", json: "" })).toBe(false);
  });

  it("keeps MVP-only refresh toggles disabled at the service-worker boundary", async () => {
    const { send } = await setupWorker();
    const response = await send({
      type: "updateSettings",
      settings: { allowAutoRefresh: true, allowInactiveTabFallback: true, refreshIntervalMinutes: 60 }
    });
    expect(response).toMatchObject({
      ok: true,
      data: {
        settings: {
          allowAutoRefresh: false,
          allowInactiveTabFallback: false,
          refreshIntervalMinutes: 60
        }
      }
    });
  });

  it("checks GitHub latest release and persists an available update", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ tag_name: "v1.1.0", html_url: "https://github.com/LeUKi/linuxdo-friends/releases/tag/v1.1.0" }), { status: 200 }))
    );
    const { send, localStorage } = await setupWorker();

    const response = await send({ type: "checkForUpdates", force: true });

    expect(response).toMatchObject({
      ok: true,
      data: {
        installedVersion: "1.0.0",
        latestVersion: "1.1.0",
        status: "update-available"
      }
    });
    expect(fetch).toHaveBeenCalledWith("https://api.github.com/repos/LeUKi/linuxdo-friends/releases/latest", expect.any(Object));
    expect(localStorage.dump()).toMatchObject({
      linuxdoFriendsUpdateCheck: {
        installedVersion: "1.0.0",
        latestVersion: "1.1.0",
        status: "update-available"
      }
    });
  });

  it("reuses cached update checks within the 12-hour TTL", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const cached = {
      installedVersion: "1.0.0",
      latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
      status: "up-to-date",
      latestVersion: "1.0.0",
      checkedAt: new Date().toISOString(),
      source: "github_release"
    };
    const { send } = await setupWorker({ initialUpdateCheck: cached });

    const response = await send({ type: "checkForUpdates" });

    expect(response).toMatchObject({ ok: true, data: cached });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent update checks before the cache is written", async () => {
    const { fetchImpl, release } = createPendingJsonFetch({
      tag_name: "v1.1.0",
      html_url: "https://github.com/LeUKi/linuxdo-friends/releases/tag/v1.1.0"
    });
    vi.stubGlobal("fetch", fetchImpl);
    const { send } = await setupWorker();

    const first = send({ type: "checkForUpdates", force: true });
    const second = send({ type: "checkForUpdates", force: true });
    await Promise.resolve();
    release();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse).toMatchObject({ ok: true, data: { status: "update-available", latestVersion: "1.1.0" } });
    expect(secondResponse).toMatchObject({ ok: true, data: { status: "update-available", latestVersion: "1.1.0" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("records a quiet no-release update-check state for GitHub 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    const { send } = await setupWorker();

    const response = await send({ type: "checkForUpdates", force: true });

    expect(response).toMatchObject({
      ok: true,
      data: {
        installedVersion: "1.0.0",
        status: "no-release",
        error: "GitHub 仓库还没有 latest release。"
      }
    });
  });

  it("falls back to the bundled GitHub API mirror when the primary API is rate-limited", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limit", { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tag_name: "v1.1.0", html_url: "https://github.com/LeUKi/linuxdo-friends/releases/tag/v1.1.0" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    const { send, localStorage } = await setupWorker();

    const response = await send({ type: "checkForUpdates", force: true });

    expect(response).toMatchObject({
      ok: true,
      data: {
        installedVersion: "1.0.0",
        latestVersion: "1.1.0",
        status: "update-available"
      }
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "https://api.github.com/repos/LeUKi/linuxdo-friends/releases/latest", expect.any(Object));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "https://github-api.lafish.workers.dev/repos/LeUKi/linuxdo-friends/releases/latest", expect.any(Object));
    expect(localStorage.dump()).toMatchObject({
      linuxdoFriendsUpdateCheck: {
        latestVersion: "1.1.0",
        status: "update-available"
      }
    });
  });

  it("records update-check failures as diagnostics instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", { status: 502 })));
    const { send } = await setupWorker();

    const response = await send({ type: "checkForUpdates", force: true });

    expect(response).toMatchObject({
      ok: true,
      data: {
        installedVersion: "1.0.0",
        status: "error",
        error: "GitHub Release 检查失败：HTTP 502"
      }
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("configures the browser action to open the side panel instead of a popup", async () => {
    const { sidePanel } = await setupWorker();

    expect(sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it("opens the side panel for the sender tab", async () => {
    const { send, sidePanel } = await setupWorker();

    const response = await send({ type: "openSidePanel" }, { tab: { id: 123, windowId: 7 } as chrome.tabs.Tab });

    expect(response).toMatchObject({ ok: true, data: { message: "已打开插件侧栏。" } });
    expect(sidePanel.open).toHaveBeenCalledWith({ tabId: 123 });
  });

  it("opens the side panel for the active tab when sender tab is unavailable", async () => {
    const { send, sidePanel, tabs } = await setupWorker({
      tabs: {
        query: vi.fn(async () => [{ id: 456, windowId: 9 } as chrome.tabs.Tab]),
        sendMessage: vi.fn()
      }
    });

    const response = await send({ type: "openSidePanel" });

    expect(response).toMatchObject({ ok: true });
    expect(tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(sidePanel.open).toHaveBeenCalledWith({ tabId: 456 });
  });

  it("opens the extension options page", async () => {
    const { send, runtime } = await setupWorker();

    const response = await send({ type: "openOptionsPage" });

    expect(response).toMatchObject({ ok: true, data: { message: "已打开配置页。" } });
    expect(runtime.openOptionsPage).toHaveBeenCalled();
  });

  it("allows session storage access from content scripts when Chrome exposes the API", async () => {
    const { sessionStorage } = await setupWorker();

    expect(sessionStorage.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });
  });

  it("persists page script status snapshots to session storage on heartbeat", async () => {
    const { send, sessionStorage } = await setupWorker();

    await send(
      {
        type: "linuxdoFriends.pageHeartbeat",
        url: "https://linux.do/",
        title: "linux.do",
        status: "ready",
        hasLauncher: true
      },
      { tab: { id: 123, windowId: 7 } as chrome.tabs.Tab }
    );

    expect(sessionStorage.dump()).toMatchObject({
      [PAGE_SCRIPT_STATUS_STORAGE_KEY]: expect.objectContaining({
        status: "connected",
        connectedCount: 1,
        selectedTabId: 123
      })
    });
  });

  it("keeps starting when session storage access-level API is missing", async () => {
    const { sidePanel } = await setupWorker({ includeSessionAccessLevel: false });

    expect(sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it("adds a friend directly from a valid profile response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => profileResponse("Neil", "Neo")));
    const { send } = await setupWorker();

    const response = await send({ type: "addFriendByProfile", username: "Neil" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        friends: { neil: { username: "neil" } },
        friendProfiles: { neil: { username: "neil", name: "Neo" } },
        lastSync: { ok: true, source: "direct_fetch" }
      }
    });
    expect(fetch).toHaveBeenCalledWith("https://linux.do/u/neil.json", expect.any(Object));
  });

  it("adds a known user locally without fetching a profile", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { send } = await setupWorker();

    const response = await send({
      type: "addFriendFromKnownUser",
      user: { username: "Neil", name: "Neo", avatarUrl: "https://linux.do/avatar.png" }
    });

    expect(response).toMatchObject({
      ok: true,
      data: {
        friends: { neil: { username: "neil" } },
        friendProfiles: { neil: { username: "neil", name: "Neo", avatarUrl: "https://linux.do/avatar.png" } }
      }
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("looks up a profile without adding a friend", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => profileResponse("Neil", "Neo")));
    const { send } = await setupWorker();

    const response = await send({ type: "lookupFriendProfile", username: "Neil" });
    const state = await send({ type: "getState" });

    expect(response).toMatchObject({
      ok: true,
      data: { username: "neil", name: "Neo" }
    });
    expect(state).toMatchObject({
      ok: true,
      data: { friends: {}, friendProfiles: {} }
    });
    expect(fetch).toHaveBeenCalledWith("https://linux.do/u/neil.json", expect.any(Object));
  });

  it("reports a missing profile lookup without adding a friend", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));
    const { send } = await setupWorker();

    const response = await send({ type: "lookupFriendProfile", username: "ghost" });
    const state = await send({ type: "getState" });

    expect(response).toMatchObject({
      ok: false,
      error: "用户不存在或公开资料不可用。",
      reason: "invalid_response"
    });
    expect(state).toMatchObject({
      ok: true,
      data: { friends: {}, friendProfiles: {} }
    });
  });

  it("does not add a friend when profile validation fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ user: { name: "No username" } }), { status: 200 })));
    const { send } = await setupWorker();

    const response = await send({ type: "addFriendByProfile", username: "ghost" });

    expect(response).toMatchObject({
      ok: true,
      data: { friends: {}, friendProfiles: {}, lastSync: { ok: false, reason: "invalid_response" } }
    });
  });

  it("falls back to an existing linux.do tab when direct profile add hits a challenge", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Enable JavaScript and cookies to continue", { status: 429 })));
    const { send, tabs } = await setupWorker({
      tabs: {
        query: vi.fn(async () => [{ id: 321, url: "https://linux.do/latest" } as chrome.tabs.Tab]),
        sendMessage: vi.fn(async () => ({
          ok: true,
          profile: {
            username: "neil",
            name: "Neo",
            refreshedAt: "2026-06-28T00:00:00.000Z"
          }
        }))
      }
    });

    const response = await send({ type: "addFriendByProfile", username: "Neil" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        friends: { neil: { username: "neil" } },
        friendProfiles: { neil: { name: "Neo" } },
        lastSync: { ok: true, source: "existing_tab" }
      }
    });
    expect(tabs.sendMessage).toHaveBeenCalledWith(321, { type: "linuxdoFriends.extractProfile", username: "Neil" });
  });

  it("identifies the current account without syncing the following list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Enable JavaScript and cookies to continue", { status: 429 })));
    const { send, tabs } = await setupWorker({
      tabs: {
        query: vi.fn(async () => [{ id: 123, url: "https://linux.do/t/topic/1" } as chrome.tabs.Tab]),
        sendMessage: vi.fn(async () => ({ ok: true, username: "lafish" }))
      }
    });

    const response = await send({ type: "identifyCurrentAccount" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        currentAccount: { username: "lafish" },
        followedUsers: {},
        lastSync: { ok: true, source: "existing_tab", message: "已识别 @lafish。" }
      }
    });
    expect(tabs.sendMessage).toHaveBeenCalledWith(123, { type: "linuxdoFriends.extractCurrentAccount" });
    expect(tabs.sendMessage).not.toHaveBeenCalledWith(123, { type: "linuxdoFriends.extractFollowing" });
  });

  it("falls back to an existing linux.do tab when direct follow sync hits a challenge", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Enable JavaScript and cookies to continue", { status: 429 })));
    const { send, tabs } = await setupWorker({
      tabs: {
        query: vi.fn(async () => [{ id: 123, url: "https://linux.do/t/topic/1" } as chrome.tabs.Tab]),
        sendMessage: vi.fn(async () => ({
          ok: true,
          username: "lafish",
          users: [{ username: "Neil", name: "Neil", avatarUrl: "https://linux.do/avatar.png" }]
        }))
      }
    });

    const response = await send({ type: "syncFollowedUsers" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        currentAccount: { username: "lafish" },
        followedUsers: { neil: { username: "neil", source: "sync" } },
        lastSync: { ok: true, source: "existing_tab" }
      }
    });
    expect(tabs.query).toHaveBeenCalledWith({ url: "https://linux.do/*" });
    expect(tabs.sendMessage).toHaveBeenCalledWith(123, { type: "linuxdoFriends.extractFollowing" });
  });

  it("caches known linux.do avatars through an existing tab", async () => {
    const state = addFriendFromProfile(defaultAppState, {
      username: "Neil",
      avatarUrl: "https://linux.do/user_avatar/linux.do/neil/48/1.png",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });
    const { send, tabs } = await setupWorker({
      initialState: state,
      tabs: {
        query: vi.fn(async () => [{ id: 123, url: "https://linux.do/t/topic/1" } as chrome.tabs.Tab]),
        sendMessage: vi.fn(async () => ({
          ok: true,
          username: "neil",
          sourceUrl: "https://linux.do/user_avatar/linux.do/neil/48/1.png",
          dataUrl: "data:image/png;base64,abc",
          contentType: "image/png",
          byteLength: 3
        }))
      }
    });

    const response = await send({ type: "cacheAvatars", usernames: ["Neil"] });

    expect(response).toMatchObject({
      ok: true,
      data: {
        avatarCache: {
          neil: {
            sourceUrl: "https://linux.do/user_avatar/linux.do/neil/48/1.png",
            dataUrl: "data:image/png;base64,abc"
          }
        }
      }
    });
    expect(tabs.sendMessage).toHaveBeenCalledWith(123, {
      type: "linuxdoFriends.extractAvatar",
      username: "neil",
      avatarUrl: "https://linux.do/user_avatar/linux.do/neil/48/1.png"
    });
  });

  it("records page script heartbeats and prefers the fresh ready tab for fallback requests", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Enable JavaScript and cookies to continue", { status: 429 })));
    const { send, tabs } = await setupWorker({
      tabs: {
        query: vi.fn(async () => [{ id: 321, url: "https://linux.do/latest" } as chrome.tabs.Tab]),
        sendMessage: vi.fn(async () => ({
          ok: true,
          profile: {
            username: "neil",
            name: "Neo",
            refreshedAt: "2026-06-28T00:00:00.000Z"
          }
        }))
      }
    });

    await send(
      { type: "linuxdoFriends.pageHeartbeat", url: "https://linux.do/latest", title: "latest", status: "ready", hasLauncher: true },
      { tab: { id: 777, windowId: 9, url: "https://linux.do/latest" } as chrome.tabs.Tab }
    );
    const status = await send({ type: "getPageScriptStatus" });
    const response = await send({ type: "addFriendByProfile", username: "Neil" });

    expect(status).toMatchObject({ ok: true, data: { status: "connected", connectedCount: 1, selectedTabId: 777 } });
    expect(response).toMatchObject({ ok: true, data: { lastSync: { ok: true, source: "existing_tab" } } });
    expect(tabs.sendMessage).toHaveBeenCalledWith(777, { type: "linuxdoFriends.extractProfile", username: "Neil" });
  });

  it("repairs an existing linux.do tab by activating and reloading it", async () => {
    const { send, tabs, windows } = await setupWorker({
      tabs: {
        query: vi.fn(async () => [{ id: 123, windowId: 7, url: "https://linux.do/latest" } as chrome.tabs.Tab]),
        sendMessage: vi.fn(),
        get: vi.fn(async () => ({ id: 123, windowId: 7, url: "https://linux.do/latest" }) as chrome.tabs.Tab),
        update: vi.fn(async () => ({ id: 123 } as chrome.tabs.Tab)),
        reload: vi.fn(async () => undefined),
        create: vi.fn()
      }
    });

    const response = await send({ type: "repairLinuxDoPageScript", tabId: 123 });

    expect(response).toMatchObject({ ok: true, data: { tabId: 123, openedNewTab: false } });
    expect(tabs.update).toHaveBeenCalledWith(123, { active: true });
    expect(tabs.reload).toHaveBeenCalledWith(123);
    expect(windows.update).toHaveBeenCalledWith(7, { focused: true });
  });

  it("opens linux.do home from an explicit repair action when no page exists", async () => {
    const { send, tabs } = await setupWorker({
      tabs: {
        query: vi.fn(async () => []),
        sendMessage: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        reload: vi.fn(),
        create: vi.fn(async () => ({ id: 999, url: "https://linux.do/" }) as chrome.tabs.Tab)
      }
    });

    const response = await send({ type: "openLinuxDoHome" });

    expect(response).toMatchObject({ ok: true, data: { tabId: 999, openedNewTab: true } });
    expect(tabs.create).toHaveBeenCalledWith({ url: "https://linux.do/", active: true });
  });

  it("falls back to an existing linux.do tab when direct profile refresh hits a challenge", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Enable JavaScript and cookies to continue", { status: 429 })));
    const state = addFriendFromProfile(defaultAppState, { username: "neil", refreshedAt: "2026-06-27T00:00:00.000Z" });
    const { send, tabs } = await setupWorker({
      initialState: state,
      tabs: {
        query: vi.fn(async () => [{ id: 456, url: "https://linux.do/latest" } as chrome.tabs.Tab]),
        sendMessage: vi.fn(async () => ({
          ok: true,
          profile: {
            username: "neil",
            name: "Neo",
            lastSeenAt: "2026-06-28T00:00:00.000Z",
            refreshedAt: "2026-06-28T00:01:00.000Z"
          }
        }))
      }
    });

    const response = await send({ type: "refreshFriendProfiles" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        friendProfiles: { neil: { name: "Neo", lastSeenAt: "2026-06-28T00:00:00.000Z" } },
        lastSync: { ok: true, source: "existing_tab" }
      }
    });
    expect(tabs.sendMessage).toHaveBeenCalledWith(456, { type: "linuxdoFriends.extractProfile", username: "neil" });
  });

  it("exposes profile refresh progress with a profiles task type", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => profileResponse("Neil", "Neo")));
    const state = addFriendFromProfile(defaultAppState, { username: "neil", refreshedAt: "2026-06-27T00:00:00.000Z" });
    const { send, runtime, sessionStorage } = await setupWorker({ initialState: state });

    const response = await send({ type: "refreshFriendProfiles" });
    const progressResponse = await send({ type: "getSiteDataProgress" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        friendProfiles: { neil: { name: "Neo" } },
        lastSync: { ok: true, source: "direct_fetch" }
      }
    });
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      type: "linuxdoFriends.siteDataProgress",
      progress: expect.objectContaining({ taskType: "profiles", status: "running", completed: 1, total: 1, currentLabel: "@neil" })
    });
    expect(sessionStorage.dump()).toMatchObject({
      [SITE_DATA_PROGRESS_STORAGE_KEY]: expect.objectContaining({ taskType: "profiles", status: "success", completed: 1, total: 1 })
    });
    expect(progressResponse).toMatchObject({
      ok: true,
      data: { taskType: "profiles", status: "success", completed: 1, total: 1, usernames: ["neil"] }
    });
  });

  it("falls back to an existing linux.do tab when direct activity refresh hits a challenge", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Enable JavaScript and cookies to continue", { status: 429 })));
    const state = addFriendFromProfile(defaultAppState, { username: "misaka7369", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const { send, tabs } = await setupWorker({
      initialState: state,
      tabs: {
        query: vi.fn(async () => [{ id: 456, url: "https://linux.do/latest" } as chrome.tabs.Tab]),
        sendMessage: vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            activity: {
              username: "misaka7369",
              refreshedAt: "2026-06-27T00:00:00.000Z",
              coarseStatus: "recently_active",
              lastPostAt: "2026-06-27T00:00:00.000Z",
              items: [
                {
                  id: "42",
                  username: "misaka7369",
                  kind: "reply",
                  source: "user_actions",
                  title: "动态",
                  occurredAt: "2026-06-27T00:00:00.000Z"
                }
              ]
            }
          })
          .mockResolvedValueOnce({
            ok: true,
            activity: {
              username: "misaka7369",
              refreshedAt: "2026-06-27T00:00:00.000Z",
              items: []
            }
          })
          .mockResolvedValueOnce({
            ok: true,
            activity: {
              username: "misaka7369",
              refreshedAt: "2026-06-27T00:00:00.000Z",
              items: []
            }
          })
          .mockResolvedValueOnce({
            ok: true,
            activity: {
              username: "misaka7369",
              refreshedAt: "2026-06-27T00:00:00.000Z",
              items: []
            }
          })
      }
    });

    const response = await send({ type: "refreshFriendActivity" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        activity: { misaka7369: { items: [{ id: "42", title: "动态" }] } },
        lastSync: { ok: true, source: "existing_tab" }
      }
    });
    expect(tabs.sendMessage).toHaveBeenCalledWith(456, {
      type: "linuxdoFriends.extractActivity",
      username: "misaka7369",
      step: { kind: "topic", path: "/user_actions.json?offset=0&username=misaka7369&filter=4" }
    });
    expect(tabs.sendMessage).toHaveBeenCalledWith(456, {
      type: "linuxdoFriends.extractActivity",
      username: "misaka7369",
      step: { kind: "reply", path: "/user_actions.json?offset=0&username=misaka7369&filter=5" }
    });
    expect(tabs.sendMessage).toHaveBeenCalledWith(456, {
      type: "linuxdoFriends.extractActivity",
      username: "misaka7369",
      step: { kind: "boost", path: "/discourse-boosts/users/misaka7369/boosts-given.json" }
    });
    expect(tabs.sendMessage).toHaveBeenCalledWith(456, {
      type: "linuxdoFriends.extractActivity",
      username: "misaka7369",
      step: { kind: "reaction", path: "/discourse-reactions/posts/reactions.json?username=misaka7369" }
    });
  });

  it("does not commit earlier friends when existing-tab activity refresh later fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Enable JavaScript and cookies to continue", { status: 429 })));
    const withFirstFriend = addFriendFromProfile(defaultAppState, { username: "neil", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const state = {
      ...addFriendFromProfile(withFirstFriend, { username: "ada", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      activity: {
        neil: {
          username: "neil",
          refreshedAt: "2026-06-26T00:00:00.000Z",
          items: [{ id: "old", username: "neil", kind: "reply" as const, title: "old", isNew: true }]
        }
      },
      activityRefreshLedger: {
        "neil:reply": {
          scopeKey: "neil:reply",
          username: "neil",
          kind: "reply" as const,
          refreshedAt: "2026-06-26T00:00:00.000Z",
          source: "direct_fetch" as const,
          itemCount: 1
        }
      },
      activityWatermarks: {
        "neil:reply": {
          scopeKey: "neil:reply",
          username: "neil",
          kind: "reply" as const,
          latestOccurredAt: "2026-06-26T00:00:00.000Z",
          updatedAt: "2026-06-26T00:00:00.000Z",
          source: "direct_fetch" as const
        }
      }
    };
    const { send } = await setupWorker({
      initialState: state,
      tabs: {
        query: vi.fn(async () => [{ id: 456, url: "https://linux.do/latest" } as chrome.tabs.Tab]),
        sendMessage: vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            activity: { username: "neil", refreshedAt: "2026-06-28T00:00:00.000Z", items: [] }
          })
          .mockResolvedValueOnce({
            ok: true,
            activity: { username: "neil", refreshedAt: "2026-06-28T00:00:00.000Z", items: [] }
          })
          .mockResolvedValueOnce({
            ok: true,
            activity: { username: "neil", refreshedAt: "2026-06-28T00:00:00.000Z", items: [] }
          })
          .mockResolvedValueOnce({ ok: false, reason: "challenge", error: "遇到浏览器验证页面，已停止请求。" })
      }
    });

    const response = await send({ type: "refreshFriendActivity" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        activity: state.activity,
        activityRefreshLedger: state.activityRefreshLedger,
        activityWatermarks: state.activityWatermarks,
        lastSync: { ok: false, source: "existing_tab", reason: "challenge" }
      }
    });
  });

  it("passes activity scope to direct refresh and exposes endpoint progress", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ boosts: [] }), { status: 200 })));
    const state = addFriendFromProfile(defaultAppState, { username: "misaka7369", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const { send, runtime, sessionStorage } = await setupWorker({ initialState: state });

    const response = await send({ type: "refreshFriendActivity", scope: { kind: "boost", usernames: ["Misaka7369"] } });
    const progressResponse = await send({ type: "getSiteDataProgress" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        activityRefreshLedger: { "misaka7369:boost": { kind: "boost", source: "direct_fetch" } },
        lastSync: { ok: true, source: "direct_fetch" }
      }
    });
    expect(fetch).toHaveBeenCalledWith("https://linux.do/discourse-boosts/users/misaka7369/boosts-given.json", expect.any(Object));
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      type: "linuxdoFriends.siteDataProgress",
      progress: expect.objectContaining({ taskType: "activity", status: "running", completed: 1, total: 1 })
    });
    expect(sessionStorage.dump()).toMatchObject({
      [SITE_DATA_PROGRESS_STORAGE_KEY]: expect.objectContaining({ taskType: "activity", status: "success", completed: 1, total: 1 })
    });
    expect(progressResponse).toMatchObject({
      ok: true,
      data: { taskType: "activity", status: "success", completed: 1, total: 1, scope: { kind: "boost", usernames: ["misaka7369"] } }
    });
  });

  it("completes activity progress with zero total when every selected friend disallows dynamic activity", async () => {
    const state = updateFriend(
      addFriendFromProfile(defaultAppState, { username: "misaka7369", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      "misaka7369",
      { activityKinds: [] }
    );
    vi.stubGlobal("fetch", vi.fn());
    const { send, sessionStorage } = await setupWorker({ initialState: state });

    const response = await send({ type: "refreshFriendActivity", scope: { kind: "all", usernames: ["Misaka7369"] } });
    const progressResponse = await send({ type: "getSiteDataProgress" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        lastSync: { ok: true, source: "direct_fetch", message: "当前视奸范围没有可刷新的动态。" }
      }
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(sessionStorage.dump()).toMatchObject({
      [SITE_DATA_PROGRESS_STORAGE_KEY]: expect.objectContaining({ taskType: "activity", status: "success", completed: 0, total: 0 })
    });
    expect(progressResponse).toMatchObject({
      ok: true,
      data: { taskType: "activity", status: "success", completed: 0, total: 0 }
    });
  });

  it("does not start duplicate site-data requests while profile refresh is pending", async () => {
    const { fetchImpl, release } = createPendingChallengeFetch();
    vi.stubGlobal("fetch", fetchImpl);
    const state = addFriendFromProfile(defaultAppState, { username: "misaka7369", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const { send } = await setupWorker({ initialState: state });

    const first = send({ type: "refreshFriendProfiles" });
    await Promise.resolve();
    const second = await send({ type: "refreshFriendActivity" });
    release();
    await first;

    expect(second).toMatchObject({
      ok: true,
      data: { lastSync: { ok: false, source: "manual", message: "已有刷新正在进行。" } }
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not start manual add while another site-data request is pending", async () => {
    const { fetchImpl, release } = createPendingChallengeFetch();
    vi.stubGlobal("fetch", fetchImpl);
    const state = addFriendFromProfile(defaultAppState, { username: "misaka7369", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const { send } = await setupWorker({ initialState: state });

    const first = send({ type: "refreshFriendActivity" });
    await Promise.resolve();
    const second = await send({ type: "addFriendByProfile", username: "neil" });
    release();
    await first;

    expect(second).toMatchObject({
      ok: true,
      data: {
        lastSync: { ok: false, source: "manual", message: "已有刷新正在进行。" }
      }
    });
    expect((second as { ok: true; data: typeof defaultAppState }).data.friends.neil).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not let an older refresh overwrite a later config import", async () => {
    let resolveFetch: (response: Response) => void = () => undefined;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => pendingFetch));
    const oldState = addFriendFromProfile(defaultAppState, { username: "Old", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const importJson = JSON.stringify({
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
      settings: { refreshIntervalMinutes: 90 }
    });
    const { send, localStorage, sessionStorage } = await setupWorker({ initialState: oldState });

    const refresh = send({ type: "refreshFriendProfiles" });
    await Promise.resolve();
    const imported = await send({ type: "importConfig", json: importJson });
    resolveFetch(profileResponse("Old", "Old"));
    const refreshResult = await refresh;

    expect(imported).toMatchObject({ ok: true, data: { friends: { neo: { username: "neo" } } } });
    expect(refreshResult).toMatchObject({
      ok: true,
      data: {
        friends: { neo: { username: "neo" } },
        lastSync: { ok: false, message: "已导入配置，较早的刷新结果已丢弃。" }
      }
    });
    expect(localStorage.dump()).toMatchObject({
      linuxdoFriendsState: {
        friends: { neo: { username: "neo" } },
        settings: { refreshIntervalMinutes: 90 }
      }
    });
    expect((localStorage.dump().linuxdoFriendsState as typeof defaultAppState).friends.old).toBeUndefined();
    expect(sessionStorage.dump()).not.toHaveProperty(SITE_DATA_PROGRESS_STORAGE_KEY);
  });

  it("clears live site-data progress and releases the refresh slot after config import", async () => {
    let resolveFirstFetch: (response: Response) => void = () => undefined;
    const firstFetch = new Promise<Response>((resolve) => {
      resolveFirstFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(firstFetch).mockResolvedValue(profileResponse("Neo", "Neo")));
    const oldState = addFriendFromProfile(defaultAppState, { username: "Old", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const importJson = JSON.stringify({
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
      settings: { refreshIntervalMinutes: 90 }
    });
    const { send } = await setupWorker({ initialState: oldState });

    const staleRefresh = send({ type: "refreshFriendProfiles" });
    await Promise.resolve();
    await send({ type: "importConfig", json: importJson });
    const progressAfterImport = await send({ type: "getSiteDataProgress" });
    const newRefresh = await send({ type: "refreshFriendProfiles" });
    resolveFirstFetch(profileResponse("Old", "Old"));
    const staleResult = await staleRefresh;

    expect(progressAfterImport).toEqual({ ok: true, data: null });
    expect(newRefresh).toMatchObject({
      ok: true,
      data: {
        friendProfiles: { neo: { username: "neo", name: "Neo" } },
        lastSync: { ok: true, source: "direct_fetch" }
      }
    });
    expect(staleResult).toMatchObject({
      ok: true,
      data: {
        friends: { neo: { username: "neo" } },
        lastSync: { ok: false, message: "已导入配置，较早的刷新结果已丢弃。" }
      }
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not let an older local settings update overwrite a later config import", async () => {
    const oldState = addFriendFromProfile(defaultAppState, { username: "Old", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const importJson = JSON.stringify({
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
      settings: { refreshIntervalMinutes: 90 }
    });
    const { send, localStorage } = await setupWorker({ initialState: oldState });

    const settingsUpdate = send({ type: "updateSettings", settings: { refreshIntervalMinutes: 60 } });
    const imported = await send({ type: "importConfig", json: importJson });
    const staleUpdate = await settingsUpdate;

    expect(imported).toMatchObject({ ok: true, data: { friends: { neo: { username: "neo" } }, settings: { refreshIntervalMinutes: 90 } } });
    expect(staleUpdate).toMatchObject({
      ok: true,
      data: {
        friends: { neo: { username: "neo" } },
        settings: { refreshIntervalMinutes: 90 },
        lastSync: { ok: false, message: "已导入配置，较早的本地修改结果已丢弃。" }
      }
    });
    expect(localStorage.dump()).toMatchObject({
      linuxdoFriendsState: {
        friends: { neo: { username: "neo" } },
        settings: { refreshIntervalMinutes: 90 }
      }
    });
  });

  it("preserves already-refreshed profiles when existing-tab fallback later fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Enable JavaScript and cookies to continue", { status: 429 })));
    const state = addFriendFromProfile(
      addFriendFromProfile(defaultAppState, { username: "neil", refreshedAt: "2026-06-27T00:00:00.000Z" }),
      { username: "ada", refreshedAt: "2026-06-27T00:00:00.000Z" }
    );
    const { send } = await setupWorker({
      initialState: state,
      tabs: {
        query: vi.fn(async () => [{ id: 789, url: "https://linux.do/latest" } as chrome.tabs.Tab]),
        sendMessage: vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            profile: { username: "neil", name: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" }
          })
          .mockResolvedValueOnce({ ok: false, reason: "challenge", error: "遇到浏览器验证页面，已停止请求。" })
      }
    });

    const response = await send({ type: "refreshFriendProfiles" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        friendProfiles: { neil: { name: "Neo" } },
        lastSync: { ok: false, source: "existing_tab", reason: "challenge" }
      }
    });
  });

  it("clears cached data while preserving friends, settings, and current account", async () => {
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Neil", name: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      followedUsers: {
        neil: {
          username: "neil",
          source: "sync",
          followedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      activity: {
        neil: { username: "neil", refreshedAt: "2026-06-28T00:00:00.000Z", items: [] }
      },
      activityRefreshLedger: {
        "neil:topic": {
          scopeKey: "topic:neil",
          username: "neil",
          kind: "topic",
          refreshedAt: "2026-06-28T00:00:00.000Z",
          source: "direct_fetch",
          itemCount: 1
        }
      },
      activityWatermarks: {
        "neil:topic": {
          scopeKey: "topic:neil",
          username: "neil",
          kind: "topic",
          latestOccurredAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
          source: "direct_fetch"
        }
      },
      activityFeedWaterlineAt: "2026-06-28T00:00:00.000Z",
      avatarCache: {
        neil: {
          username: "neil",
          sourceUrl: "https://linux.do/avatar.png",
          dataUrl: "data:image/png;base64,abc",
          contentType: "image/png",
          byteLength: 3,
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" as const },
      settings: { ...defaultAppState.settings, refreshIntervalMinutes: 60 }
    };
    const { send, sessionStorage } = await setupWorker({
      initialState: state,
      initialSession: { [SITE_DATA_PROGRESS_STORAGE_KEY]: { taskId: "old" } }
    });

    const response = await send({ type: "clearCache" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        friends: { neil: { username: "neil" } },
        followedUsers: {},
        friendProfiles: {},
        activity: {},
        activityRefreshLedger: {},
        activityWatermarks: {},
        avatarCache: {},
        currentAccount: { username: "lafish" },
        settings: { refreshIntervalMinutes: 60 },
        lastSync: { ok: true, message: "已清理缓存，佬朋友和设置已保留。" }
      }
    });
    expect(sessionStorage.dump()).not.toHaveProperty(SITE_DATA_PROGRESS_STORAGE_KEY);
  });

  it("exports only friends and settings config", async () => {
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Neil", name: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      followedUsers: {
        neil: {
          username: "neil",
          source: "sync",
          followedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      activity: { neil: { username: "neil", refreshedAt: "2026-06-28T00:00:00.000Z", items: [] } },
      avatarCache: {
        neil: {
          username: "neil",
          sourceUrl: "https://linux.do/avatar.png",
          dataUrl: "data:image/png;base64,abc",
          contentType: "image/png",
          byteLength: 3,
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" as const },
      settings: { ...defaultAppState.settings, refreshIntervalMinutes: 60 }
    };
    const { send } = await setupWorker({ initialState: state });

    const response = await send({ type: "exportConfig" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        schemaVersion: 1,
        source: "linuxdo-friends",
        friends: { neil: { username: "neil" } },
        settings: { refreshIntervalMinutes: 60, allowAutoRefresh: false, allowInactiveTabFallback: false }
      }
    });
    const exported = (response as { ok: true; data: Record<string, unknown> }).data;
    expect(exported).not.toHaveProperty("currentAccount");
    expect(exported).not.toHaveProperty("followedUsers");
    expect(exported).not.toHaveProperty("avatarCache");
    expect(exported).not.toHaveProperty("activity");
  });

  it("imports config with overwrite semantics and clears non-migratable state", async () => {
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Old", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      followedUsers: {
        old: {
          username: "old",
          source: "sync",
          followedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      activity: { old: { username: "old", refreshedAt: "2026-06-28T00:00:00.000Z", items: [] } },
      currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" as const }
    };
    const json = JSON.stringify({
      schemaVersion: 1,
      source: "linuxdo-friends",
      exportedAt: "2026-06-28T00:00:00.000Z",
      friends: {
        neo: {
          username: "neo",
          note: "NAS",
          groups: ["ops"],
          pinned: true,
          upgradedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      settings: { refreshIntervalMinutes: 90 }
    });
    const { send, localStorage, sessionStorage } = await setupWorker({
      initialState: state,
      initialUpdateCheck: {
        installedVersion: "1.0.0",
        latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
        status: "up-to-date",
        latestVersion: "1.0.0",
        checkedAt: "2026-06-28T00:00:00.000Z",
        source: "github_release"
      },
      initialSession: {
        [SITE_DATA_PROGRESS_STORAGE_KEY]: { taskId: "old" },
        [PAGE_SCRIPT_STATUS_STORAGE_KEY]: { status: "connected" },
        "linuxdoFriendsUiScene.tab": "feed"
      }
    });

    const response = await send({ type: "importConfig", json });

    expect(response).toMatchObject({
      ok: true,
      data: {
        friends: { neo: { username: "neo", note: "NAS", groups: ["ops"], pinned: true } },
        settings: { refreshIntervalMinutes: 90, allowAutoRefresh: false, allowInactiveTabFallback: false },
        followedUsers: {},
        friendProfiles: {},
        activity: {},
        avatarCache: {},
        lastSync: { ok: true, message: "已导入 1 位佬朋友配置。" }
      }
    });
    expect((response as { ok: true; data: typeof defaultAppState }).data.currentAccount).toBeUndefined();
    expect((localStorage.dump().linuxdoFriendsState as typeof defaultAppState).friends.old).toBeUndefined();
    expect(localStorage.dump()).not.toHaveProperty("linuxdoFriendsUpdateCheck");
    expect(sessionStorage.dump()).not.toHaveProperty(SITE_DATA_PROGRESS_STORAGE_KEY);
    expect(sessionStorage.dump()).not.toHaveProperty(PAGE_SCRIPT_STATUS_STORAGE_KEY);
    expect(sessionStorage.dump()).not.toHaveProperty("linuxdoFriendsUiScene.tab");
  });

  it("does not change state when config import validation fails", async () => {
    const state = addFriendFromProfile(defaultAppState, { username: "Old", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const { send, localStorage } = await setupWorker({ initialState: state });

    const response = await send({ type: "importConfig", json: "{" });

    expect(response).toMatchObject({ ok: false, error: "配置文件不是有效的 JSON。" });
    expect(localStorage.dump()).toMatchObject({
      linuxdoFriendsState: {
        friends: { old: { username: "old" } }
      }
    });
  });

  it("does not change state when config import has invalid settings schema", async () => {
    const state = addFriendFromProfile(defaultAppState, { username: "Old", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const { send, localStorage } = await setupWorker({ initialState: state });

    const response = await send({
      type: "importConfig",
      json: JSON.stringify({
        schemaVersion: 1,
        source: "linuxdo-friends",
        exportedAt: "2026-06-28T00:00:00.000Z",
        friends: {},
        settings: { refreshIntervalMinutes: "bad" }
      })
    });

    expect(response).toMatchObject({ ok: false, error: "配置文件的刷新间隔不正确。" });
    expect(localStorage.dump()).toMatchObject({
      linuxdoFriendsState: {
        friends: { old: { username: "old" } }
      }
    });
  });

  it("fully resets local extension data and session state", async () => {
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" as const }
    };
    const { send, localStorage, sessionStorage } = await setupWorker({
      initialState: state,
      initialUpdateCheck: {
        installedVersion: "1.0.0",
        latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
        status: "up-to-date",
        latestVersion: "1.0.0",
        checkedAt: "2026-06-28T00:00:00.000Z",
        source: "github_release"
      },
      initialSession: {
        [SITE_DATA_PROGRESS_STORAGE_KEY]: { taskId: "old" },
        [PAGE_SCRIPT_STATUS_STORAGE_KEY]: { status: "connected" },
        "linuxdoFriendsUiScene.tab": "feed"
      }
    });

    const response = await send({ type: "resetExtension" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        friends: {},
        settings: defaultAppState.settings,
        lastSync: { ok: true, message: "已全量重置插件。" }
      }
    });
    expect((response as { ok: true; data: typeof defaultAppState }).data.currentAccount).toBeUndefined();
    expect(localStorage.dump()).toMatchObject({
      linuxdoFriendsState: {
        friends: {}
      }
    });
    expect((localStorage.dump().linuxdoFriendsState as typeof defaultAppState).currentAccount).toBeUndefined();
    expect(localStorage.dump()).not.toHaveProperty("linuxdoFriendsUpdateCheck");
    expect(sessionStorage.dump()).not.toHaveProperty(SITE_DATA_PROGRESS_STORAGE_KEY);
    expect(sessionStorage.dump()).not.toHaveProperty(PAGE_SCRIPT_STATUS_STORAGE_KEY);
    expect(sessionStorage.dump()).not.toHaveProperty("linuxdoFriendsUiScene.tab");
  });
});

type MockTabs = {
  query: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  reload?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
};

async function setupWorker(
  overrides: {
    tabs?: MockTabs;
    initialState?: unknown;
    initialUpdateCheck?: unknown;
    initialSession?: Record<string, unknown>;
    includeSessionAccessLevel?: boolean;
  } = {}
) {
  let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
  const runtime = {
    sendMessage: vi.fn(),
    openOptionsPage: vi.fn(),
    getURL: vi.fn((path: string) => `chrome-extension://linuxdo-friends/${path}`),
    onMessage: {
      addListener: vi.fn((callback) => {
        listener = callback;
      })
    }
  };
  const tabs = {
    query: vi.fn(async () => []),
    sendMessage: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    reload: vi.fn(),
    create: vi.fn(),
    ...overrides.tabs
  };
  const windows = {
    update: vi.fn()
  };
  const sidePanel = {
    open: vi.fn(),
    setPanelBehavior: vi.fn()
  };
  const sessionStorage = {
    ...createMockStorage(overrides.initialSession ?? {}),
    ...(overrides.includeSessionAccessLevel === false ? {} : { setAccessLevel: vi.fn() })
  };
  const localStorage = createMockStorage({
    ...(overrides.initialState ? { linuxdoFriendsState: overrides.initialState } : {}),
    ...(overrides.initialUpdateCheck ? { linuxdoFriendsUpdateCheck: overrides.initialUpdateCheck } : {})
  });
  vi.stubGlobal("chrome", {
    runtime: {
      ...runtime,
      getManifest: vi.fn(() => ({ version: "1.0.0" }))
    },
    storage: {
      local: localStorage,
      session: sessionStorage
    },
    tabs,
    windows,
    sidePanel
  });

  await import("./serviceWorker");
  expect(listener).toBeTruthy();
  return {
    runtime,
    localStorage,
    sidePanel,
    sessionStorage,
    tabs,
    windows,
    send(message: unknown, sender: chrome.runtime.MessageSender = {}) {
      return new Promise((resolve) => {
        listener?.(message, sender, resolve);
      });
    }
  };
}

function createPendingChallengeFetch() {
  let resolveFetch: (response: Response) => void = () => undefined;
  const pendingFetch = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  return {
    fetchImpl: vi.fn(() => pendingFetch),
    release() {
      resolveFetch(new Response("Enable JavaScript and cookies to continue", { status: 429 }));
    }
  };
}

function createPendingJsonFetch(payload: unknown) {
  let resolveFetch: (response: Response) => void = () => undefined;
  const pendingFetch = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  return {
    fetchImpl: vi.fn(() => pendingFetch),
    release() {
      resolveFetch(new Response(JSON.stringify(payload), { status: 200 }));
    }
  };
}

function profileResponse(username: string, name: string): Response {
  return new Response(
    JSON.stringify({
      user: {
        username,
        name,
        avatar_template: `/user_avatar/linux.do/${username.toLowerCase()}/{size}/1.png`
      }
    }),
    { status: 200 }
  );
}
