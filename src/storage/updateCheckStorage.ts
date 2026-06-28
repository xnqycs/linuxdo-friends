import { compareVersions, defaultUpdateCheckState, GITHUB_LATEST_RELEASE_URL } from "../domain/versionCheck";
import type { UpdateCheckState, UpdateCheckStatus } from "../shared/types";

export const UPDATE_CHECK_STORAGE_KEY = "linuxdoFriendsUpdateCheck";

type LocalStorageLike = {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
};

type StorageChanges = Record<string, chrome.storage.StorageChange>;

const fallbackStore: { state: UpdateCheckState | null } = { state: null };

export async function loadUpdateCheckState(
  installedVersion: string,
  storage: LocalStorageLike | null = getChromeLocalStorage()
): Promise<UpdateCheckState> {
  if (!storage) return normalizeUpdateCheckState(fallbackStore.state, installedVersion);
  const result = await storage.get(UPDATE_CHECK_STORAGE_KEY);
  return normalizeUpdateCheckState(result[UPDATE_CHECK_STORAGE_KEY], installedVersion);
}

export async function saveUpdateCheckState(
  state: UpdateCheckState,
  storage: LocalStorageLike | null = getChromeLocalStorage()
): Promise<void> {
  if (!storage) {
    fallbackStore.state = state;
    return;
  }
  await storage.set({ [UPDATE_CHECK_STORAGE_KEY]: state });
}

export function updateCheckStateFromStorageChanges(
  changes: StorageChanges,
  installedVersion: string
): UpdateCheckState | undefined {
  if (!(UPDATE_CHECK_STORAGE_KEY in changes)) return undefined;
  return normalizeUpdateCheckState(changes[UPDATE_CHECK_STORAGE_KEY].newValue, installedVersion);
}

export function resetUpdateCheckFallbackStorage() {
  fallbackStore.state = null;
}

export function normalizeUpdateCheckState(value: unknown, installedVersion: string): UpdateCheckState {
  if (!isRecord(value) || !isUpdateCheckStatus(value.status)) {
    return defaultUpdateCheckState(installedVersion);
  }
  const latestVersion = optionalString(value.latestVersion);
  const status = normalizeCachedStatus(value.status, latestVersion, installedVersion);
  return {
    installedVersion,
    latestReleaseUrl: typeof value.latestReleaseUrl === "string" && value.latestReleaseUrl ? value.latestReleaseUrl : GITHUB_LATEST_RELEASE_URL,
    status,
    latestVersion,
    checkedAt: optionalString(value.checkedAt),
    error: status === "error" ? (optionalString(value.error) ?? "缓存的 Release 版本号无法识别。") : optionalString(value.error),
    source: value.source === "github_release" ? "github_release" : undefined
  };
}

function normalizeCachedStatus(status: UpdateCheckStatus, latestVersion: string | undefined, installedVersion: string): UpdateCheckStatus {
  if (status !== "update-available" && status !== "up-to-date") return status;
  if (!latestVersion) return status;
  const comparison = compareVersions(latestVersion, installedVersion);
  if (comparison == null) return "error";
  return comparison > 0 ? "update-available" : "up-to-date";
}

function getChromeLocalStorage(): LocalStorageLike | null {
  if (typeof chrome === "undefined") return null;
  return chrome.storage?.local ?? null;
}

function isUpdateCheckStatus(value: unknown): value is UpdateCheckStatus {
  return value === "idle" || value === "checking" || value === "up-to-date" || value === "update-available" || value === "no-release" || value === "error";
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
