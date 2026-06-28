import { createRefreshAdapter } from "../api/refreshAdapter";
import { sortActivityItems } from "../domain/activity";
import {
  applyScopedActivityRefresh,
  clearActivityNewFlags,
  latestActivityRefreshAt,
  normalizeActivityRefreshScope,
  normalizeRefreshTargets,
  planActivityRefreshTargets,
  type ActivityRequestStep
} from "../domain/activityRefresh";
import { defaultAppState } from "../domain/defaultState";
import { addFriendFromKnownUser, addFriendFromProfile, removeFriend, updateFriend, upsertFollowedUser, upsertFriendProfile } from "../domain/friends";
import {
  defaultUpdateCheckState,
  GITHUB_LATEST_RELEASE_API,
  isUpdateCheckCacheFresh,
  updateCheckFailureState,
  updateCheckStateFromRelease
} from "../domain/versionCheck";
import { isBackgroundCommand } from "../messages/contracts";
import { nowIso } from "../shared/time";
import type {
  ActivityItem,
  ActivityRefreshKind,
  ActivityKindFilter,
  ActivityRefreshScope,
  ActivityRefreshTaskProgress,
  AppState,
  BackgroundCommand,
  BackgroundResponse,
  ContentScriptActivityResponse,
  ContentScriptAvatarResponse,
  ContentScriptCurrentAccountResponse,
  ContentScriptFollowingResponse,
  ContentScriptHeartbeatMessage,
  ContentScriptProfileResponse,
  PageRepairResult,
  PageScriptHeartbeat,
  PageScriptStatusSnapshot,
  ProfileRefreshTaskProgress,
  RefreshResult,
  SiteDataTaskProgress,
  UpdateCheckState,
  Username
} from "../shared/types";
import { PAGE_SCRIPT_STATUS_STORAGE_KEY, savePageScriptStatusState } from "../storage/pageScriptStatusStorage";
import { SITE_DATA_PROGRESS_STORAGE_KEY, saveSiteDataProgressState } from "../storage/siteDataProgressStorage";
import { loadState, saveState, updateState } from "../storage/storage";
import { UPDATE_CHECK_STORAGE_KEY, loadUpdateCheckState, saveUpdateCheckState } from "../storage/updateCheckStorage";
import { allUiSceneStorageKeys } from "../storage/uiSceneStorage";

const refreshAdapter = createRefreshAdapter();
interface ActiveSiteDataTask {
  taskId: string;
  promise: Promise<BackgroundResponse>;
  progress?: SiteDataTaskProgress;
}

let activeSiteDataTask: ActiveSiteDataTask | null = null;
let activeUpdateCheck: Promise<UpdateCheckState> | null = null;
let lastSiteDataProgress: SiteDataTaskProgress | null = null;
const pageScriptHeartbeats = new Map<number, PageScriptHeartbeat>();
const heartbeatFreshMs = 45_000;
const heartbeatStaleMs = 120_000;

configureSessionStorageAccess();
configureSidePanelAction();

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isContentScriptHeartbeatMessage(message)) {
    const response = handlePageHeartbeat(message, sender);
    sendResponse(response);
    return false;
  }
  void handleMessage(message, sender).then(sendResponse);
  return true;
});

function configureSidePanelAction() {
  try {
    void chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });
  } catch {
    // Some test and non-Chrome environments expose only a subset of extension APIs.
  }
}

function configureSessionStorageAccess() {
  try {
    void chrome.storage?.session?.setAccessLevel?.({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });
  } catch {
    // Content-script access depends on Chrome support; tests and partial APIs may not expose it.
  }
}

async function handleMessage(message: unknown, sender: chrome.runtime.MessageSender): Promise<BackgroundResponse> {
  if (!isBackgroundCommand(message)) {
    return { ok: false, error: "未知命令。", reason: "unknown_command" };
  }
  try {
    return await dispatch(message, sender);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "操作失败。" };
  }
}

async function dispatch(command: BackgroundCommand, sender: chrome.runtime.MessageSender): Promise<BackgroundResponse> {
  switch (command.type) {
    case "getState":
      return ok(await loadState());
    case "identifyCurrentAccount":
      return ok(await identifyCurrentAccount());
    case "seedFollowedUser":
      return ok(await updateState((state) => upsertFollowedUser(state, { ...command.user, source: "manual" })));
    case "lookupFriendProfile":
      return lookupFriendProfileWithFallback(command.username);
    case "addFriendFromKnownUser":
      return ok(await updateState((state) => addFriendFromKnownUser(state, command.user, command.profile)));
    case "addFriendByProfile":
      return runSiteDataTask(() => refreshState((state) => addFriendByProfileWithFallback(state, command.username)));
    case "removeFriend":
      return ok(await updateState((state) => removeFriend(state, command.username)));
    case "updateFriend":
      return ok(await updateState((state) => updateFriend(state, command.username, command.patch)));
    case "syncFollowedUsers":
      return runSiteDataTask(() => refreshState(syncFollowedUsersWithFallback));
    case "refreshFriendProfiles":
      return runSiteDataTask(() => refreshState((state) => refreshFriendProfilesWithFallback(state, command.usernames)));
    case "refreshFriendActivity":
      return runSiteDataTask(() =>
        refreshState((state) => refreshFriendActivityWithFallback(state, command.scope ?? { kind: "all", usernames: command.usernames }))
      );
    case "cacheAvatars":
      return ok(await cacheAvatarsFromExistingTab(command.usernames));
    case "getSiteDataProgress":
      return ok(activeSiteDataTask?.progress ?? lastSiteDataProgress);
    case "getPageScriptStatus":
      return ok(pageScriptStatusSnapshot());
    case "getUpdateCheck":
      return ok(await loadUpdateCheckState(installedVersion()));
    case "checkForUpdates":
      return ok(await checkForUpdates(command.force === true));
    case "repairLinuxDoPageScript":
      return ok(await repairLinuxDoPageScript(command.tabId));
    case "openSidePanel":
      return ok(await openSidePanel(sender));
    case "openOptionsPage":
      return ok(await openOptionsPage());
    case "openLinuxDoHome":
      return ok(await openLinuxDoHome());
    case "updateSettings":
      return ok(
        await updateState((state) => ({
          ...state,
          settings: {
            ...state.settings,
            ...applyMvpSettingsGuard(command.settings)
          }
        }))
      );
    case "clearCache":
      return ok(await clearCache());
    case "resetExtension":
      return ok(await resetExtension());
  }
}

async function identifyCurrentAccount(): Promise<AppState> {
  const current = await loadState();
  const result = (await identifyCurrentAccountFromExistingTab(current)) ?? (await refreshAdapter.identifyCurrentAccount(current));
  const next = {
    ...result.state,
    lastSync: result.result
  };
  await saveState(next);
  return next;
}

async function identifyCurrentAccountFromExistingTab(state: AppState): Promise<{ state: AppState; result: RefreshResult } | null> {
  const response = await sendToAvailableLinuxDoTab(sendExtractCurrentAccountMessage);
  if (!response) return null;
  if (!response.ok) {
    return {
      state,
      result: {
        ok: false,
        source: "existing_tab",
        reason: response.reason === "unavailable" ? "unavailable" : response.reason,
        message: response.error,
        refreshedAt: nowIso()
      }
    };
  }
  return {
    state: {
      ...state,
      currentAccount: { username: response.username, verifiedAt: nowIso(), source: "latest_header" }
    },
    result: {
      ok: true,
      source: "existing_tab",
      message: `已识别 @${response.username}。`,
      refreshedAt: nowIso()
    }
  };
}

async function clearCache(): Promise<AppState> {
  const next = await updateState((state) => ({
    ...state,
    followedUsers: {},
    friendProfiles: {},
    activity: {},
    activityRefreshLedger: {},
    activityWatermarks: {},
    activityFeedWaterlineAt: undefined,
    avatarCache: {},
    lastSync: {
      ok: true,
      source: "manual",
      message: "已清理缓存，佬朋友和设置已保留。",
      refreshedAt: nowIso()
    }
  }));
  await removeSessionStorageKeys([SITE_DATA_PROGRESS_STORAGE_KEY]);
  lastSiteDataProgress = null;
  return next;
}

async function resetExtension(): Promise<AppState> {
  const next: AppState = {
    ...defaultAppState,
    lastSync: {
      ok: true,
      source: "manual",
      message: "已全量重置插件。",
      refreshedAt: nowIso()
    }
  };
  await saveState(next);
  await removeLocalStorageKeys([UPDATE_CHECK_STORAGE_KEY]);
  await removeSessionStorageKeys([SITE_DATA_PROGRESS_STORAGE_KEY, PAGE_SCRIPT_STATUS_STORAGE_KEY, ...allUiSceneStorageKeys]);
  pageScriptHeartbeats.clear();
  lastSiteDataProgress = null;
  return next;
}

async function removeLocalStorageKeys(keys: string[]) {
  try {
    await chrome.storage?.local?.remove?.(keys);
  } catch {
    // Storage cleanup is best effort; the canonical app state is saved separately.
  }
}

async function removeSessionStorageKeys(keys: string[]) {
  try {
    await chrome.storage?.session?.remove?.(keys);
  } catch {
    // Session storage may be unavailable in tests or older Chrome surfaces.
  }
}

async function checkForUpdates(force: boolean): Promise<UpdateCheckState> {
  const installed = installedVersion();
  const cached = await loadUpdateCheckState(installed);
  if (!force && cached.checkedAt && isUpdateCheckCacheFresh(cached)) return cached;
  if (activeUpdateCheck) return activeUpdateCheck;

  const request = fetchLatestReleaseUpdateState(installed).finally(() => {
    if (activeUpdateCheck === request) activeUpdateCheck = null;
  });
  activeUpdateCheck = request;
  return request;
}

async function fetchLatestReleaseUpdateState(installed: string): Promise<UpdateCheckState> {
  let next: UpdateCheckState;
  try {
    const response = await fetch(GITHUB_LATEST_RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json"
      }
    });
    if (response.status === 404) {
      next = updateCheckFailureState(installed, "no-release", "GitHub 仓库还没有 latest release。");
    } else if (!response.ok) {
      next = updateCheckFailureState(installed, "error", `GitHub Release 检查失败：HTTP ${response.status}`);
    } else {
      next = updateCheckStateFromRelease(installed, (await response.json()) as Record<string, unknown>);
    }
  } catch (error) {
    next = updateCheckFailureState(installed, "error", error instanceof Error ? error.message : "GitHub Release 检查失败。");
  }
  await saveUpdateCheckState(next);
  return next;
}

function installedVersion(): string {
  return chrome.runtime.getManifest?.().version ?? defaultUpdateCheckState("0.0.0").installedVersion;
}

async function openSidePanel(sender: chrome.runtime.MessageSender): Promise<{ message: string }> {
  if (!chrome.sidePanel?.open) {
    throw new Error("当前浏览器不支持插件侧栏。");
  }
  const senderTabId = sender.tab?.id;
  const senderWindowId = sender.tab?.windowId;
  if (typeof senderTabId === "number") {
    await chrome.sidePanel.open({ tabId: senderTabId });
    return { message: "已打开插件侧栏。" };
  }
  if (typeof senderWindowId === "number") {
    await chrome.sidePanel.open({ windowId: senderWindowId });
    return { message: "已打开插件侧栏。" };
  }
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (typeof activeTab?.id === "number") {
    await chrome.sidePanel.open({ tabId: activeTab.id });
    return { message: "已打开插件侧栏。" };
  }
  if (typeof activeTab?.windowId === "number") {
    await chrome.sidePanel.open({ windowId: activeTab.windowId });
    return { message: "已打开插件侧栏。" };
  }
  throw new Error("没有找到可以打开侧栏的浏览器窗口。");
}

async function openOptionsPage(): Promise<{ message: string }> {
  if (chrome.runtime.openOptionsPage) {
    await chrome.runtime.openOptionsPage();
    return { message: "已打开配置页。" };
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL("src/options/index.html"), active: true });
  return { message: "已打开配置页。" };
}

async function addFriendByProfileWithFallback(
  state: AppState,
  username: Username
): Promise<{ state: AppState; result: RefreshResult }> {
  const direct = await refreshAdapter.addFriendByProfile(state, username);
  if (direct.result?.ok) return direct;
  if (!shouldTryExistingTab(direct.result)) return direct;

  const existingTab = await addFriendByProfileFromExistingTab(direct.state, username);
  if (existingTab) return existingTab;
  return {
    state: direct.state,
    result: {
      ok: false,
      source: "existing_tab",
      reason: direct.result.reason,
      message: `${direct.result.message} 请打开一个 linux.do 页面后再添加。`,
      refreshedAt: nowIso()
    }
  };
}

async function lookupFriendProfileWithFallback(username: Username): Promise<BackgroundResponse> {
  const direct = await refreshAdapter.lookupFriendProfile(username);
  if (direct.ok) return ok(direct.profile);
  if (!shouldTryExistingTab(direct.result)) return { ok: false, error: direct.result.message, reason: direct.result.reason };

  const response = await sendToAvailableLinuxDoTab((tabId) => sendExtractProfileMessage(tabId, username));
  if (!response) {
    return {
      ok: false,
      error: `${direct.result.message} 请打开一个 linux.do 页面后再查找。`,
      reason: direct.result.reason
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: response.error,
      reason: response.reason === "unavailable" ? "unavailable" : response.reason
    };
  }
  return ok(response.profile);
}

async function runSiteDataTask(run: () => Promise<BackgroundResponse>): Promise<BackgroundResponse> {
  if (activeSiteDataTask) {
    const current = await loadState();
    return ok({
      ...current,
      lastSync: {
        ok: false,
        source: "manual",
        reason: "unavailable",
        message: "已有刷新正在进行。",
        refreshedAt: nowIso()
      }
    });
  }
  const taskId = `site-data:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const taskRecord: ActiveSiteDataTask = {
    taskId,
    promise: Promise.resolve({ ok: false, error: "任务尚未开始。" } satisfies BackgroundResponse)
  };
  activeSiteDataTask = taskRecord;
  const task = run();
  taskRecord.promise = task;
  try {
    return await task;
  } finally {
    if (activeSiteDataTask === taskRecord) activeSiteDataTask = null;
  }
}

async function refreshFriendProfilesWithFallback(
  state: AppState,
  usernames?: Username[]
): Promise<{ state: AppState; result: RefreshResult }> {
  startProfileProgress(state, usernames, "direct_fetch");
  const direct = await refreshAdapter.refreshFriendProfiles(state, usernames, (username) => incrementProfileProgress(username, "direct_fetch"));
  if (direct.result?.ok) {
    finishSiteDataProgress("success");
    return direct;
  }
  if (!shouldTryExistingTab(direct.result)) {
    finishSiteDataProgress("error", direct.result.message);
    return direct;
  }

  finishSiteDataProgress("error", direct.result.message);
  startProfileProgress(direct.state, usernames, "existing_tab");
  const existingTab = await refreshFriendProfilesFromExistingTab(direct.state, usernames);
  if (existingTab) {
    finishSiteDataProgress(existingTab.result.ok ? "success" : "error", existingTab.result.ok ? undefined : existingTab.result.message);
    return existingTab;
  }
  const missingTabResult: { state: AppState; result: RefreshResult } = {
    state: direct.state,
    result: {
      ok: false,
      source: "existing_tab",
      reason: direct.result.reason,
      message: `${direct.result.message} 请打开一个 linux.do 页面后再刷新状态。`,
      refreshedAt: nowIso()
    }
  };
  finishSiteDataProgress("error", missingTabResult.result.message);
  return missingTabResult;
}

async function syncFollowedUsersWithFallback(state: AppState): Promise<{ state: AppState; result: RefreshResult }> {
  const direct = await refreshAdapter.syncFollowedUsers(state);
  if (direct.result?.ok) return direct;
  if (!shouldTryExistingTab(direct.result)) return direct;

  const existingTab = await syncFollowedUsersFromExistingTab(direct.state);
  if (existingTab) return existingTab;
  return {
    state: direct.state,
    result: {
      ok: false,
      source: "existing_tab",
      reason: direct.result.reason,
      message: `${direct.result.message} 请打开一个 linux.do 页面后再同步。`,
      refreshedAt: nowIso()
    }
  };
}

async function addFriendByProfileFromExistingTab(
  state: AppState,
  username: Username
): Promise<{ state: AppState; result: RefreshResult } | null> {
  const response = await sendToAvailableLinuxDoTab((tabId) => sendExtractProfileMessage(tabId, username));
  if (!response) return null;
  if (!response.ok) {
    return {
      state,
      result: {
        ok: false,
        source: "existing_tab",
        reason: response.reason === "unavailable" ? "unavailable" : response.reason,
        message: response.error,
        refreshedAt: nowIso()
      }
    };
  }
  return {
    state: addFriendFromProfile(state, response.profile),
    result: {
      ok: true,
      source: "existing_tab",
      message: `已通过已打开的 linux.do 页面添加 @${response.profile.username} 为佬朋友。`,
      refreshedAt: nowIso()
    }
  };
}

async function refreshFriendProfilesFromExistingTab(
  state: AppState,
  usernames?: Username[]
): Promise<{ state: AppState; result: RefreshResult } | null> {
  const targets = normalizeRefreshTargets(state, usernames);
  let nextState = state;
  let refreshedCount = 0;
  for (const username of targets) {
    const response = await sendToAvailableLinuxDoTab((tabId) => sendExtractProfileMessage(tabId, username));
    if (!response) return null;
    if (!response.ok) {
      return {
        state: nextState,
        result: {
          ok: false,
          source: "existing_tab",
          reason: response.reason === "unavailable" ? "unavailable" : response.reason,
          message: response.error,
          refreshedAt: nowIso()
        }
      };
    }
    nextState = upsertFriendProfile(nextState, response.profile);
    refreshedCount += 1;
    incrementProfileProgress(username, "existing_tab");
  }
  return {
    state: nextState,
    result: {
      ok: true,
      source: "existing_tab",
      message: `已通过已打开的 linux.do 页面刷新 ${refreshedCount} 位佬朋友状态。`,
      refreshedAt: nowIso()
    }
  };
}

async function refreshFriendActivityWithFallback(
  state: AppState,
  scopeInput?: ActivityRefreshScope
): Promise<{ state: AppState; result: RefreshResult }> {
  const scope = normalizeActivityRefreshScope(scopeInput);
  startActivityProgress(state, scope, "direct_fetch");
  const direct = await refreshAdapter.refreshFriendActivity(state, scope, (step) => incrementActivityProgress(step, "direct_fetch"));
  if (direct.result?.ok) {
    finishActivityProgress("success");
    return direct;
  }
  const directFailure = direct.result as Exclude<RefreshResult, { ok: true }>;
  if (!shouldTryExistingTab(directFailure)) {
    finishActivityProgress("error", directFailure.message);
    return direct;
  }

  startActivityProgress(direct.state, scope, "existing_tab");
  const existingTab = await refreshFriendActivityFromExistingTab(direct.state, scope);
  if (existingTab) {
    finishActivityProgress(existingTab.result.ok ? "success" : "error", existingTab.result.ok ? undefined : existingTab.result.message);
    return existingTab;
  }
  const missingTabResult: { state: AppState; result: RefreshResult } = {
    state: direct.state,
    result: {
      ok: false,
      source: "existing_tab",
      reason: directFailure.reason,
      message: `${directFailure.message} 请打开一个 linux.do 页面后再刷新动态。`,
      refreshedAt: nowIso()
    }
  };
  finishActivityProgress("error", missingTabResult.result.message);
  return missingTabResult;
}

function shouldTryExistingTab(result: RefreshResult): boolean {
  return !result.ok && ["challenge", "blocked", "rate_limited", "unavailable", "network_error"].includes(result.reason);
}

function startActivityProgress(state: AppState, scope: ActivityRefreshScope, source: RefreshResult["source"]) {
  if (!activeSiteDataTask) return;
  const targets = planActivityRefreshTargets(state, scope);
  const now = nowIso();
  const progress: ActivityRefreshTaskProgress = {
    taskId: activeSiteDataTask.taskId,
    taskType: "activity",
    status: "running",
    scope,
    completed: 0,
    total: targets.reduce((sum, target) => sum + target.steps.length, 0),
    source,
    startedAt: now,
    updatedAt: now
  };
  setActivityProgress(progress);
}

function startProfileProgress(state: AppState, usernames: Username[] | undefined, source: RefreshResult["source"]) {
  if (!activeSiteDataTask) return;
  const targets = normalizeRefreshTargets(state, usernames);
  const now = nowIso();
  const progress: ProfileRefreshTaskProgress = {
    taskId: activeSiteDataTask.taskId,
    taskType: "profiles",
    status: "running",
    usernames: targets,
    completed: 0,
    total: targets.length,
    source,
    startedAt: now,
    updatedAt: now
  };
  setSiteDataProgress(progress);
}

function incrementActivityProgress(step: ActivityRequestStep, source: RefreshResult["source"]) {
  if (!activeSiteDataTask?.progress || activeSiteDataTask.progress.taskType !== "activity") return;
  setActivityProgress({
    ...activeSiteDataTask.progress,
    status: "running",
    completed: Math.min(activeSiteDataTask.progress.completed + 1, activeSiteDataTask.progress.total),
    currentLabel: step.label,
    source,
    updatedAt: nowIso()
  });
}

function incrementProfileProgress(username: Username, source: RefreshResult["source"]) {
  if (!activeSiteDataTask?.progress || activeSiteDataTask.progress.taskType !== "profiles") return;
  setSiteDataProgress({
    ...activeSiteDataTask.progress,
    status: "running",
    completed: Math.min(activeSiteDataTask.progress.completed + 1, activeSiteDataTask.progress.total),
    currentLabel: `@${username}`,
    source,
    updatedAt: nowIso()
  });
}

function finishActivityProgress(status: "success" | "error", error?: string) {
  finishSiteDataProgress(status, error);
}

function finishSiteDataProgress(status: "success" | "error", error?: string) {
  if (!activeSiteDataTask?.progress) return;
  const now = nowIso();
  setSiteDataProgress({
    ...activeSiteDataTask.progress,
    status,
    updatedAt: now,
    finishedAt: now,
    error
  });
}

function setActivityProgress(progress: ActivityRefreshTaskProgress) {
  setSiteDataProgress(progress);
}

function setSiteDataProgress(progress: SiteDataTaskProgress) {
  if (activeSiteDataTask) {
    activeSiteDataTask.progress = progress;
  }
  lastSiteDataProgress = progress;
  void saveSiteDataProgressState(progress);
  broadcastSiteDataProgress(progress);
}

function broadcastSiteDataProgress(progress: SiteDataTaskProgress) {
  try {
    void chrome.runtime.sendMessage({ type: "linuxdoFriends.siteDataProgress", progress });
  } catch {
    // Popup or side-panel may be closed while the task continues.
  }
}

async function syncFollowedUsersFromExistingTab(state: AppState): Promise<{ state: AppState; result: RefreshResult } | null> {
  const response = await sendToAvailableLinuxDoTab(sendExtractFollowingMessage);
  if (!response) return null;
  if (!response.ok) {
    return {
      state,
      result: {
        ok: false,
        source: "existing_tab",
        reason: response.reason === "unavailable" ? "unavailable" : response.reason,
        message: response.error,
        refreshedAt: nowIso()
      }
    };
  }

  let nextState: AppState = {
    ...state,
    currentAccount: { username: response.username, verifiedAt: nowIso(), source: "latest_header" }
  };
  for (const user of response.users) {
    nextState = upsertFollowedUser(nextState, { ...user, source: "sync" });
  }
  return {
    state: nextState,
    result: {
      ok: true,
      source: "existing_tab",
      message: `已通过已打开的 linux.do 页面识别 @${response.username}，同步 ${response.users.length} 位关注用户。`,
      refreshedAt: nowIso()
    }
  };
}

async function refreshFriendActivityFromExistingTab(
  state: AppState,
  scopeInput?: ActivityRefreshScope
): Promise<{ state: AppState; result: RefreshResult } | null> {
  const scope = normalizeActivityRefreshScope(scopeInput);
  const targets = planActivityRefreshTargets(state, scope);
  const collectedTargets: Array<{ username: Username; items: ActivityItem[]; refreshedKinds: ActivityRefreshKind[] }> = [];
  const feedWaterlineAt = latestActivityRefreshAt(state);
  let refreshedCount = 0;
  for (const target of targets) {
    const items: ActivityItem[] = [];
    for (const step of target.steps) {
      const response = await sendToAvailableLinuxDoTab((tabId) => sendExtractActivityMessage(tabId, target.username, step.kind));
      if (!response) return null;
      if (!response.ok) {
        return {
          state,
          result: {
            ok: false,
            source: "existing_tab",
            reason: response.reason === "unavailable" ? "unavailable" : response.reason,
            message: response.error,
            refreshedAt: nowIso()
          }
        };
      }
      items.push(...response.activity.items);
      incrementActivityProgress(step, "existing_tab");
    }
    collectedTargets.push({ username: target.username, items: sortActivityItems(items), refreshedKinds: target.refreshedKinds });
    refreshedCount += 1;
  }
  let nextState = collectedTargets.length ? clearActivityNewFlags(state) : state;
  for (const target of collectedTargets) {
    nextState = applyScopedActivityRefresh(
      nextState,
      target.username,
      target.items,
      target.refreshedKinds,
      "existing_tab",
      undefined,
      { clearExistingNew: false, feedWaterlineAt }
    );
  }
  return {
    state: nextState,
    result: {
      ok: true,
      source: "existing_tab",
      message: `已通过已打开的 linux.do 页面刷新 ${refreshedCount} 位好友动态。`,
      refreshedAt: nowIso()
    }
  };
}

async function findUsableLinuxDoTabId(): Promise<number | null> {
  const ids = await linuxDoTabCandidateIds();
  return ids[0] ?? null;
}

async function linuxDoTabCandidateIds(): Promise<number[]> {
  const seen = new Set<number>();
  const ids: number[] = [];
  function add(id: unknown) {
    if (typeof id !== "number" || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  }
  freshReadyHeartbeats().forEach((heartbeat) => add(heartbeat.tabId));
  try {
    const tabs = await chrome.tabs.query({ url: "https://linux.do/*" });
    tabs.forEach((tab) => add(tab.id));
  } catch {
    // Heartbeat candidates are still useful if tab query is unavailable.
  }
  return ids;
}

async function cacheAvatarsFromExistingTab(usernames?: Username[]): Promise<AppState> {
  const state = await loadState();
  const targets = avatarCacheTargets(state, usernames);
  if (targets.length === 0) return state;
  let nextState = state;
  for (const target of targets) {
    const response = await sendToAvailableLinuxDoTab((tabId) => sendExtractAvatarMessage(tabId, target.username, target.avatarUrl));
    if (!response || !response.ok) continue;
    nextState = {
      ...nextState,
      avatarCache: {
        ...nextState.avatarCache,
        [target.username]: {
          username: target.username,
          sourceUrl: response.sourceUrl,
          dataUrl: response.dataUrl,
          contentType: response.contentType,
          byteLength: response.byteLength,
          updatedAt: nowIso()
        }
      }
    };
  }
  if (nextState !== state) await saveState(nextState);
  return nextState;
}

type LinuxDoContentResponse =
  | ContentScriptCurrentAccountResponse
  | ContentScriptFollowingResponse
  | ContentScriptProfileResponse
  | ContentScriptActivityResponse
  | ContentScriptAvatarResponse;

async function sendToAvailableLinuxDoTab<T extends LinuxDoContentResponse>(send: (tabId: number) => Promise<T>): Promise<T | null> {
  const ids = await linuxDoTabCandidateIds();
  let lastUnavailable: T | null = null;
  for (const tabId of ids) {
    const response = await send(tabId);
    if (response.ok) return response;
    if (response.reason !== "unavailable") return response;
    pageScriptHeartbeats.delete(tabId);
    lastUnavailable = response;
  }
  return lastUnavailable;
}

function isContentScriptHeartbeatMessage(value: unknown): value is ContentScriptHeartbeatMessage {
  if (typeof value !== "object" || value == null) return false;
  const message = value as Partial<ContentScriptHeartbeatMessage>;
  return (
    message.type === "linuxdoFriends.pageHeartbeat" &&
    typeof message.url === "string" &&
    (message.title === undefined || typeof message.title === "string") &&
    (message.status === "ready" || message.status === "challenge" || message.status === "unavailable") &&
    typeof message.hasLauncher === "boolean"
  );
}

function handlePageHeartbeat(message: ContentScriptHeartbeatMessage, sender: chrome.runtime.MessageSender): PageScriptStatusSnapshot {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    return pageScriptStatusSnapshot();
  }
  const heartbeat: PageScriptHeartbeat = {
    tabId,
    windowId: sender.tab?.windowId,
    url: message.url,
    title: message.title,
    status: message.status,
    hasLauncher: message.hasLauncher,
    updatedAt: nowIso()
  };
  pageScriptHeartbeats.set(tabId, heartbeat);
  prunePageHeartbeats();
  broadcastPageScriptStatus();
  return pageScriptStatusSnapshot();
}

function pageScriptStatusSnapshot(): PageScriptStatusSnapshot {
  prunePageHeartbeats();
  const now = nowIso();
  const entries = [...pageScriptHeartbeats.values()].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  const fresh = entries.filter((entry) => Date.now() - Date.parse(entry.updatedAt) <= heartbeatFreshMs);
  const ready = fresh.filter((entry) => entry.status === "ready");
  const challenge = fresh.filter((entry) => entry.status === "challenge");
  const staleCount = entries.length - fresh.length;
  return {
    status: ready.length > 0 ? "connected" : challenge.length > 0 ? "challenge" : entries.length > 0 ? "stale" : "missing",
    connectedCount: ready.length,
    staleCount,
    heartbeats: entries,
    selectedTabId: ready[0]?.tabId,
    updatedAt: now
  };
}

function freshReadyHeartbeats(): PageScriptHeartbeat[] {
  prunePageHeartbeats();
  const nowMs = Date.now();
  return [...pageScriptHeartbeats.values()]
    .filter((entry) => entry.status === "ready" && nowMs - Date.parse(entry.updatedAt) <= heartbeatFreshMs)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function prunePageHeartbeats() {
  const nowMs = Date.now();
  for (const [tabId, heartbeat] of pageScriptHeartbeats) {
    if (nowMs - Date.parse(heartbeat.updatedAt) > heartbeatStaleMs) {
      pageScriptHeartbeats.delete(tabId);
    }
  }
}

function broadcastPageScriptStatus() {
  const status = pageScriptStatusSnapshot();
  void savePageScriptStatusState(status);
  try {
    void chrome.runtime.sendMessage({ type: "linuxdoFriends.pageScriptStatus", status });
  } catch {
    // Side panel may be closed. The next getPageScriptStatus call will read the in-memory snapshot.
  }
}

async function repairLinuxDoPageScript(tabId?: number): Promise<PageRepairResult> {
  const targetTab = await findRepairTargetTab(tabId);
  if (targetTab?.id == null) {
    return openLinuxDoHome();
  }
  await activateTab(targetTab);
  try {
    await chrome.tabs.reload(targetTab.id);
  } catch {
    // Activating the page is still useful if reload is unavailable in a constrained browser surface.
  }
  return { message: "已切换并刷新 linux.do 页面。", tabId: targetTab.id, openedNewTab: false };
}

async function openLinuxDoHome(): Promise<PageRepairResult> {
  const existing = await findRepairTargetTab();
  if (existing?.id != null) {
    await activateTab(existing);
    return { message: "已切换到 linux.do 页面，请完成浏览器验证后重试。", tabId: existing.id, openedNewTab: false };
  }
  const tab = await chrome.tabs.create({ url: "https://linux.do/", active: true });
  return { message: "已打开 linux.do 首页，请完成浏览器验证后重试。", tabId: tab.id, openedNewTab: true };
}

async function findRepairTargetTab(tabId?: number): Promise<chrome.tabs.Tab | null> {
  try {
    if (typeof tabId === "number") {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.url?.startsWith("https://linux.do/")) return tab;
    }
  } catch {
    pageScriptHeartbeats.delete(tabId ?? -1);
  }
  const heartbeatTabId = pageScriptStatusSnapshot().selectedTabId ?? pageScriptStatusSnapshot().heartbeats[0]?.tabId;
  if (typeof heartbeatTabId === "number") {
    try {
      const tab = await chrome.tabs.get(heartbeatTabId);
      if (tab?.url?.startsWith("https://linux.do/")) return tab;
    } catch {
      pageScriptHeartbeats.delete(heartbeatTabId);
    }
  }
  try {
    const tabs = await chrome.tabs.query({ url: "https://linux.do/*" });
    return tabs.find((candidate) => typeof candidate.id === "number") ?? null;
  } catch {
    return null;
  }
}

async function activateTab(tab: chrome.tabs.Tab) {
  if (tab.id == null) return;
  await chrome.tabs.update(tab.id, { active: true });
  if (typeof tab.windowId === "number") {
    try {
      await chrome.windows?.update?.(tab.windowId, { focused: true });
    } catch {
      // Focusing the window is best effort; activating the tab is the core repair.
    }
  }
}

function avatarCacheTargets(state: AppState, usernames?: Username[]): Array<{ username: Username; avatarUrl: string }> {
  const requested = usernames?.length ? usernames : Object.keys(state.friends);
  const seen = new Set<Username>();
  const targets: Array<{ username: Username; avatarUrl: string }> = [];
  for (const usernameInput of requested) {
    const username = usernameInput.trim().replace(/^@/, "").toLowerCase();
    if (!username || seen.has(username)) continue;
    seen.add(username);
    const avatarUrl = state.friendProfiles[username]?.avatarUrl || state.followedUsers[username]?.avatarUrl;
    if (!avatarUrl || state.avatarCache[username]?.sourceUrl === avatarUrl) continue;
    if (!isLinuxDoAvatarUrl(avatarUrl)) continue;
    targets.push({ username, avatarUrl });
  }
  return targets.slice(0, 20);
}

function isLinuxDoAvatarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "linux.do" && (url.pathname.startsWith("/user_avatar/") || url.pathname.startsWith("/letter_avatar/"));
  } catch {
    return false;
  }
}

async function sendExtractFollowingMessage(tabId: number): Promise<ContentScriptFollowingResponse> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, { type: "linuxdoFriends.extractFollowing" })) as
      | ContentScriptFollowingResponse
      | undefined;
    return response ?? { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面没有响应同步请求，请刷新页面后重试。" };
  } catch {
    return { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面未加载佬朋友脚本，请刷新 linux.do 页面后重试。" };
  }
}

async function sendExtractCurrentAccountMessage(tabId: number): Promise<ContentScriptCurrentAccountResponse> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, { type: "linuxdoFriends.extractCurrentAccount" })) as
      | ContentScriptCurrentAccountResponse
      | undefined;
    return response ?? { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面没有响应账号识别请求，请刷新页面后重试。" };
  } catch {
    return { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面未加载佬朋友脚本，请刷新 linux.do 页面后重试。" };
  }
}

async function sendExtractAvatarMessage(tabId: number, username: Username, avatarUrl: string): Promise<ContentScriptAvatarResponse> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: "linuxdoFriends.extractAvatar",
      username,
      avatarUrl
    })) as ContentScriptAvatarResponse | undefined;
    return response ?? { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面没有响应头像缓存请求。" };
  } catch {
    return { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面未加载佬朋友脚本，请刷新 linux.do 页面后重试。" };
  }
}

async function sendExtractProfileMessage(tabId: number, username: Username): Promise<ContentScriptProfileResponse> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: "linuxdoFriends.extractProfile",
      username
    })) as ContentScriptProfileResponse | undefined;
    return response ?? { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面没有响应状态刷新请求，请刷新页面后重试。" };
  } catch {
    return { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面未加载佬朋友脚本，请刷新 linux.do 页面后重试。" };
  }
}

async function sendExtractActivityMessage(
  tabId: number,
  username: Username,
  kind: ActivityKindFilter | "user_actions"
): Promise<ContentScriptActivityResponse> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: "linuxdoFriends.extractActivity",
      username,
      kind
    })) as ContentScriptActivityResponse | undefined;
    return response ?? { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面没有响应动态刷新请求，请刷新页面后重试。" };
  } catch {
    return { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面未加载佬朋友脚本，请刷新 linux.do 页面后重试。" };
  }
}

function applyMvpSettingsGuard(settings: Partial<AppState["settings"]>): Partial<AppState["settings"]> {
  return {
    ...settings,
    allowAutoRefresh: false,
    allowInactiveTabFallback: false
  };
}

async function refreshState(
  run: (state: AppState) => Promise<{ state: AppState; result: AppState["lastSync"] }>
): Promise<BackgroundResponse> {
  const current = await loadState();
  const { state, result } = await run(current);
  const next = { ...state, lastSync: result };
  await saveState(next);
  return ok(next);
}

function ok<T>(data: T): BackgroundResponse<T> {
  return { ok: true, data };
}
