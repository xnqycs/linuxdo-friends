import { defaultAppState } from "./defaultState";
import { normalizeActivityKinds, normalizeFriendUser, normalizeUsername } from "./friends";
import { nowIso } from "../shared/time";
import type { AppState, FriendUser, RefreshSettings } from "../shared/types";

export const CONFIG_EXPORT_SCHEMA_VERSION = 1;
export const CONFIG_EXPORT_SOURCE = "linuxdo-friends";
export type ConfigExportSchemaVersion = typeof CONFIG_EXPORT_SCHEMA_VERSION;

export interface ConfigExportFile {
  schemaVersion: ConfigExportSchemaVersion;
  source: "linuxdo-friends";
  exportedAt: string;
  friends: Record<string, FriendUser>;
  settings: RefreshSettings;
}

export interface ConfigImportResult {
  state: AppState;
}

export function createConfigExport(state: AppState, exportedAt: string = nowIso()): ConfigExportFile {
  return {
    schemaVersion: CONFIG_EXPORT_SCHEMA_VERSION,
    source: CONFIG_EXPORT_SOURCE,
    exportedAt,
    friends: normalizeFriendsRecord(state.friends),
    settings: normalizeStoredSettings(state.settings)
  };
}

export function parseConfigImportJson(text: string): ConfigExportFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("配置文件不是有效的 JSON。");
  }
  return normalizeConfigFile(json);
}

export function applyConfigImport(file: ConfigExportFile, importedAt: string = nowIso()): ConfigImportResult {
  const friends = normalizeFriendsRecord(file.friends);
  return {
    state: {
      ...defaultAppState,
      friends,
      settings: normalizeImportedSettings(file.settings),
      lastSync: {
        ok: true,
        source: "manual",
        message: `已导入 ${Object.keys(friends).length} 位佬朋友配置。`,
        refreshedAt: importedAt
      }
    }
  };
}

function normalizeConfigFile(value: unknown): ConfigExportFile {
  if (!isRecord(value)) throw new Error("配置文件结构不正确。");
  switch (value.schemaVersion) {
    case CONFIG_EXPORT_SCHEMA_VERSION:
      return normalizeConfigFileV1(value);
    default:
      throw new Error("配置文件版本不支持。");
  }
}

function normalizeConfigFileV1(value: Record<string, unknown>): ConfigExportFile {
  if (value.source !== CONFIG_EXPORT_SOURCE) throw new Error("配置文件来源不正确。");
  if (typeof value.exportedAt !== "string" || !value.exportedAt.trim()) throw new Error("配置文件缺少导出时间。");
  if (!isRecord(value.friends)) throw new Error("配置文件缺少佬朋友配置。");
  if (!isRecord(value.settings)) throw new Error("配置文件缺少设置。");
  return {
    schemaVersion: CONFIG_EXPORT_SCHEMA_VERSION,
    source: CONFIG_EXPORT_SOURCE,
    exportedAt: value.exportedAt,
    friends: normalizeFriendsRecord(value.friends),
    settings: normalizeImportedSettings(value.settings)
  };
}

function normalizeFriendsRecord(value: Record<string, unknown>): Record<string, FriendUser> {
  const friends: Record<string, FriendUser> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isRecord(item)) throw new Error("佬朋友配置格式不正确。");
    const username = normalizeUsername(typeof item.username === "string" ? item.username : key);
    if (!username) throw new Error("佬朋友配置包含无效用户名。");
    friends[username] = {
      ...normalizeFriendUser({
        username,
        note: typeof item.note === "string" ? item.note : "",
        groups: normalizeGroups(item.groups),
        pinned: item.pinned === true,
        activityKinds: normalizeActivityKinds(item.activityKinds),
        upgradedAt: normalizeTimestamp(item.upgradedAt),
        updatedAt: normalizeTimestamp(item.updatedAt)
      }),
      upgradedAt: normalizeTimestamp(item.upgradedAt),
      updatedAt: normalizeTimestamp(item.updatedAt)
    };
  }
  return friends;
}

function normalizeGroups(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("佬朋友分组格式不正确。");
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function normalizeStoredSettings(value: Partial<RefreshSettings> | Record<string, unknown>): RefreshSettings {
  const refreshIntervalMinutes =
    typeof value.refreshIntervalMinutes === "number" &&
    Number.isFinite(value.refreshIntervalMinutes) &&
    value.refreshIntervalMinutes >= 30 &&
    value.refreshIntervalMinutes <= 720
      ? value.refreshIntervalMinutes
      : defaultAppState.settings.refreshIntervalMinutes;
  return {
    ...defaultAppState.settings,
    refreshIntervalMinutes,
    openActivityLinksInPage: value.openActivityLinksInPage === true,
    allowAutoRefresh: false,
    allowInactiveTabFallback: false
  };
}

function normalizeImportedSettings(value: Partial<RefreshSettings> | Record<string, unknown>): RefreshSettings {
  if (
    typeof value.refreshIntervalMinutes !== "number" ||
    !Number.isFinite(value.refreshIntervalMinutes) ||
    value.refreshIntervalMinutes < 30 ||
    value.refreshIntervalMinutes > 720
  ) {
    throw new Error("配置文件的刷新间隔不正确。");
  }
  if (value.allowAutoRefresh !== undefined && typeof value.allowAutoRefresh !== "boolean") {
    throw new Error("配置文件的自动刷新设置不正确。");
  }
  if (value.allowInactiveTabFallback !== undefined && typeof value.allowInactiveTabFallback !== "boolean") {
    throw new Error("配置文件的后台标签页设置不正确。");
  }
  if (value.openActivityLinksInPage !== undefined && typeof value.openActivityLinksInPage !== "boolean") {
    throw new Error("配置文件的动态跳转设置不正确。");
  }
  return {
    ...defaultAppState.settings,
    refreshIntervalMinutes: value.refreshIntervalMinutes,
    openActivityLinksInPage: value.openActivityLinksInPage === true,
    allowAutoRefresh: false,
    allowInactiveTabFallback: false
  };
}

function normalizeTimestamp(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : nowIso();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
