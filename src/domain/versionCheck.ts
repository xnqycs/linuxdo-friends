import { nowIso } from "../shared/time";
import type { UpdateCheckState } from "../shared/types";

export const GITHUB_LATEST_RELEASE_API = "https://api.github.com/repos/LeUKi/linuxdo-friends/releases/latest";
export const GITHUB_LATEST_RELEASE_URL = "https://github.com/LeUKi/linuxdo-friends/releases/latest";
export const UPDATE_CHECK_TTL_MS = 12 * 60 * 60 * 1000;

export interface GitHubLatestReleasePayload {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
}

export function defaultUpdateCheckState(installedVersion: string): UpdateCheckState {
  return {
    installedVersion,
    latestReleaseUrl: GITHUB_LATEST_RELEASE_URL,
    status: "idle"
  };
}

export function normalizeVersionTag(value: string): string | null {
  const trimmed = value.trim();
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(trimmed);
  if (!match) return null;
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function compareVersions(leftInput: string, rightInput: string): number | null {
  const left = normalizeVersionTag(leftInput);
  const right = normalizeVersionTag(rightInput);
  if (!left || !right) return null;
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

export function isNewerVersion(latestVersion: string, installedVersion: string): boolean {
  return compareVersions(latestVersion, installedVersion) === 1;
}

export function isUpdateCheckCacheFresh(state: UpdateCheckState | null | undefined, nowMs = Date.now()): boolean {
  if (!state?.checkedAt) return false;
  const checkedAtMs = Date.parse(state.checkedAt);
  return Number.isFinite(checkedAtMs) && nowMs - checkedAtMs >= 0 && nowMs - checkedAtMs < UPDATE_CHECK_TTL_MS;
}

export function updateCheckStateFromRelease(
  installedVersion: string,
  payload: GitHubLatestReleasePayload,
  checkedAt = nowIso()
): UpdateCheckState {
  const rawVersion = typeof payload.tag_name === "string" ? payload.tag_name : typeof payload.name === "string" ? payload.name : "";
  const latestVersion = normalizeVersionTag(rawVersion);
  const latestReleaseUrl = typeof payload.html_url === "string" && payload.html_url ? payload.html_url : GITHUB_LATEST_RELEASE_URL;
  if (!latestVersion) {
    return {
      installedVersion,
      latestReleaseUrl: GITHUB_LATEST_RELEASE_URL,
      status: "error",
      checkedAt,
      error: "最新 Release 的版本号不是 vX.Y.Z 格式。",
      source: "github_release"
    };
  }
  return {
    installedVersion,
    latestReleaseUrl,
    status: isNewerVersion(latestVersion, installedVersion) ? "update-available" : "up-to-date",
    latestVersion,
    checkedAt,
    source: "github_release"
  };
}

export function updateCheckFailureState(
  installedVersion: string,
  status: "no-release" | "error",
  error: string,
  checkedAt = nowIso()
): UpdateCheckState {
  return {
    installedVersion,
    latestReleaseUrl: GITHUB_LATEST_RELEASE_URL,
    status,
    checkedAt,
    error,
    source: "github_release"
  };
}
