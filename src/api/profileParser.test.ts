import { describe, expect, it } from "vitest";
import { extractFriendProfile } from "./profileParser";

describe("profile parser", () => {
  it("extracts and normalizes /u/{username}.json user profile fields", () => {
    const profile = extractFriendProfile({
      user: {
        username: "Misaka7369",
        name: "御坂",
        avatar_template: "/user_avatar/linux.do/misaka7369/{size}/1.png",
        last_posted_at: "2026-06-28T00:10:00.000Z",
        last_seen_at: "2026-06-28T00:12:00.000Z"
      }
    });

    expect(profile).toMatchObject({
      username: "misaka7369",
      name: "御坂",
      avatarUrl: "https://linux.do/user_avatar/linux.do/misaka7369/48/1.png",
      lastPostedAt: "2026-06-28T00:10:00.000Z",
      lastSeenAt: "2026-06-28T00:12:00.000Z"
    });
    expect(profile.refreshedAt).toBeTruthy();
  });

  it("keeps optional status fields undefined when missing", () => {
    expect(extractFriendProfile({ user: { username: "Neil" } })).toMatchObject({
      username: "neil",
      lastPostedAt: undefined,
      lastSeenAt: undefined
    });
  });

  it("rejects malformed responses without user.username", () => {
    expect(() => extractFriendProfile({ user: { name: "No username" } })).toThrow("Invalid linux.do profile response");
    expect(() => extractFriendProfile({})).toThrow("Invalid linux.do profile response");
  });
});
