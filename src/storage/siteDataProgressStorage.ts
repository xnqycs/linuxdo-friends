import type { ActivityKindFilter, SiteDataTaskProgress } from "../shared/types";

export const SITE_DATA_PROGRESS_STORAGE_KEY = "linuxdoFriendsSiteDataProgress";

type SessionStorageLike = {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
};

type StorageChanges = Record<string, chrome.storage.StorageChange>;

const fallbackStore: { progress: SiteDataTaskProgress | null } = { progress: null };

export async function loadSiteDataProgressState(
  storage: SessionStorageLike | null = getChromeSessionStorage()
): Promise<SiteDataTaskProgress | null> {
  if (!storage) return fallbackStore.progress;
  const result = await storage.get(SITE_DATA_PROGRESS_STORAGE_KEY);
  return normalizeSiteDataProgress(result[SITE_DATA_PROGRESS_STORAGE_KEY]);
}

export async function saveSiteDataProgressState(
  progress: SiteDataTaskProgress,
  storage: SessionStorageLike | null = getChromeSessionStorage()
): Promise<void> {
  if (!storage) {
    fallbackStore.progress = progress;
    return;
  }
  await storage.set({ [SITE_DATA_PROGRESS_STORAGE_KEY]: progress });
}

export function siteDataProgressFromStorageChanges(changes: StorageChanges): SiteDataTaskProgress | null | undefined {
  if (!(SITE_DATA_PROGRESS_STORAGE_KEY in changes)) return undefined;
  return normalizeSiteDataProgress(changes[SITE_DATA_PROGRESS_STORAGE_KEY].newValue);
}

export function resetSiteDataProgressFallbackStorage() {
  fallbackStore.progress = null;
}

export function normalizeSiteDataProgress(value: unknown): SiteDataTaskProgress | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.taskId !== "string" ||
    (value.taskType !== "activity" && value.taskType !== "profiles") ||
    (value.status !== "running" && value.status !== "success" && value.status !== "error") ||
    typeof value.completed !== "number" ||
    typeof value.total !== "number" ||
    typeof value.startedAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  if (value.taskType === "activity") {
    if (!isRecord(value.scope) || !isActivityKindFilter(value.scope.kind)) return null;
    const scope = {
      kind: value.scope.kind,
      usernames: isUsernameList(value.scope.usernames) ? value.scope.usernames : undefined
    };
    return {
      taskId: value.taskId,
      taskType: "activity",
      scope,
      status: value.status,
      completed: value.completed,
      total: value.total,
      currentLabel: optionalString(value.currentLabel),
      source: normalizeRefreshSource(value.source),
      startedAt: value.startedAt,
      updatedAt: value.updatedAt,
      finishedAt: optionalString(value.finishedAt),
      error: optionalString(value.error)
    };
  }
  if (!isUsernameList(value.usernames)) return null;
  return {
    taskId: value.taskId,
    taskType: "profiles",
    usernames: value.usernames,
    status: value.status,
    completed: value.completed,
    total: value.total,
    currentLabel: optionalString(value.currentLabel),
    source: normalizeRefreshSource(value.source),
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
    finishedAt: optionalString(value.finishedAt),
    error: optionalString(value.error)
  };
}

function getChromeSessionStorage(): SessionStorageLike | null {
  if (typeof chrome === "undefined") return null;
  return chrome.storage?.session ?? null;
}

function normalizeRefreshSource(value: unknown) {
  return value === "direct_fetch" || value === "existing_tab" || value === "manual" ? value : undefined;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function isUsernameList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function isActivityKindFilter(value: unknown): value is ActivityKindFilter {
  return value === "all" || value === "topic" || value === "reply" || value === "boost" || value === "reaction";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
