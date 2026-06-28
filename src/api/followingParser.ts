import type { FollowedUser } from "../shared/types";

export function extractFollowedUsers(json: unknown): Array<Pick<FollowedUser, "username" | "name" | "avatarUrl">> {
  const records = getFollowedUserRecords(json);
  return records.flatMap((record) => {
    const username = readString(record, "username");
    if (!username) return [];
    return [
      {
        username,
        name: readString(record, "name"),
        avatarUrl: avatarUrlFromRecord(record)
      }
    ];
  });
}

function getFollowedUserRecords(json: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(json)) return json.filter(isRecord);
  if (!isRecord(json)) return [];
  for (const key of ["users", "following", "members"]) {
    const value = json[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function avatarUrlFromRecord(record: Record<string, unknown>): string | undefined {
  const avatarTemplate = readString(record, "avatar_template");
  const avatarUrl = avatarTemplate?.replace("{size}", "48") ?? readString(record, "avatar_url") ?? readString(record, "avatarUrl");
  if (!avatarUrl) return undefined;
  if (avatarUrl.startsWith("//")) return `https:${avatarUrl}`;
  if (avatarUrl.startsWith("/")) return `https://linux.do${avatarUrl}`;
  return avatarUrl;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
