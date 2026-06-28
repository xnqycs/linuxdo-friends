import type { BackgroundCommand } from "../shared/types";

export function isBackgroundCommand(value: unknown): value is BackgroundCommand {
  if (typeof value !== "object" || value == null) return false;
  const command = value as Record<string, unknown>;
  switch (command.type) {
    case "getState":
    case "syncFollowedUsers":
    case "getSiteDataProgress":
    case "getPageScriptStatus":
    case "openSidePanel":
    case "openOptionsPage":
    case "openLinuxDoHome":
      return true;
    case "repairLinuxDoPageScript":
      return command.tabId === undefined || isPositiveInteger(command.tabId);
    case "seedFollowedUser":
      return isSeedFollowedCommand(command);
    case "addFriendFromKnownUser":
      return isKnownUserAddCommand(command);
    case "lookupFriendProfile":
    case "addFriendByProfile":
    case "removeFriend":
      return isNonEmptyString(command.username);
    case "updateFriend":
      return isNonEmptyString(command.username) && isFriendPatch(command.patch);
    case "refreshFriendProfiles":
    case "cacheAvatars":
      return command.usernames === undefined || isUsernameList(command.usernames);
    case "refreshFriendActivity":
      return isActivityRefreshCommand(command);
    case "updateSettings":
      return isSettingsPatch(command.settings);
    default:
      return false;
  }
}

function isActivityRefreshCommand(command: Record<string, unknown>): boolean {
  const legacyUsernamesValid = command.usernames === undefined || isUsernameList(command.usernames);
  if (!legacyUsernamesValid) return false;
  if (command.scope === undefined) return true;
  if (!isRecord(command.scope)) return false;
  return isActivityKindFilter(command.scope.kind) && (command.scope.usernames === undefined || isUsernameList(command.scope.usernames));
}

function isSeedFollowedCommand(command: Record<string, unknown>): boolean {
  if (!isRecord(command.user)) return false;
  return (
    isNonEmptyString(command.user.username) &&
    isOptionalString(command.user.name) &&
    isOptionalString(command.user.avatarUrl)
  );
}

function isKnownUserAddCommand(command: Record<string, unknown>): boolean {
  if (!isSeedFollowedCommand(command)) return false;
  if (command.profile === undefined) return true;
  if (!isRecord(command.profile)) return false;
  return isNonEmptyString(command.profile.username) && isOptionalString(command.profile.name) && isOptionalString(command.profile.avatarUrl);
}

function isFriendPatch(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isOptionalString(value.note) &&
    (value.groups === undefined || isStringList(value.groups)) &&
    (value.pinned === undefined || typeof value.pinned === "boolean")
  );
}

function isSettingsPatch(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    (value.allowAutoRefresh === undefined || typeof value.allowAutoRefresh === "boolean") &&
    (value.allowInactiveTabFallback === undefined || typeof value.allowInactiveTabFallback === "boolean") &&
    (value.refreshIntervalMinutes === undefined || isValidRefreshInterval(value.refreshIntervalMinutes))
  );
}

function isValidRefreshInterval(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 30 && value <= 720;
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isUsernameList(value: unknown): boolean {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isActivityKindFilter(value: unknown): boolean {
  return value === "all" || value === "topic" || value === "reply" || value === "boost" || value === "reaction";
}

function isStringList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
