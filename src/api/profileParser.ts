import { avatarUrlFromTemplate } from "../domain/activity";
import { normalizeUsername } from "../domain/friends";
import { nowIso } from "../shared/time";
import type { FriendProfileSummary } from "../shared/types";

type RawRecord = Record<string, unknown>;

export function extractFriendProfile(json: unknown): FriendProfileSummary {
  if (!isRecord(json) || !isRecord(json.user)) {
    throw new Error("Invalid linux.do profile response");
  }
  const username = readString(json.user, "username");
  if (!username) {
    throw new Error("Invalid linux.do profile response");
  }
  const avatarTemplate = readString(json.user, "avatar_template");
  const avatarUrl = avatarUrlFromTemplate(avatarTemplate) ?? avatarUrlFromTemplate(readString(json.user, "avatar_url"));
  return {
    username: normalizeUsername(username),
    name: readString(json.user, "name"),
    avatarUrl,
    lastPostedAt: readString(json.user, "last_posted_at"),
    lastSeenAt: readString(json.user, "last_seen_at"),
    refreshedAt: nowIso()
  };
}

function readString(record: RawRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
