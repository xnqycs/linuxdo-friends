import { describe, expect, it } from "vitest";
import { defaultAppState } from "./defaultState";
import { addFriendFromKnownUser, addFriendFromProfile, removeFriend, updateFriend, upsertFriendProfile } from "./friends";

describe("friend profile-backed domain operations", () => {
  it("adds a validated profile without requiring followedUsers", () => {
    const state = addFriendFromProfile(defaultAppState, {
      username: "Neil",
      name: "Neo",
      avatarUrl: "https://linux.do/avatar.png",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });

    expect(state.friends.neil).toMatchObject({ username: "neil", note: "", groups: [] });
    expect(state.friendProfiles.neil).toMatchObject({ username: "neil", name: "Neo" });
  });

  it("preserves local metadata when adding an existing friend again", () => {
    const state = addFriendFromProfile(defaultAppState, {
      username: "Neil",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });
    const withMetadata = updateFriend(state, "neil", { note: "old friend", groups: ["core"], pinned: true });
    const next = addFriendFromProfile(withMetadata, {
      username: "NEIL",
      name: "Neo",
      refreshedAt: "2026-06-28T00:01:00.000Z"
    });

    expect(next.friends.neil).toMatchObject({
      note: "old friend",
      groups: ["core"],
      pinned: true,
      upgradedAt: state.friends.neil.upgradedAt
    });
    expect(next.friendProfiles.neil).toMatchObject({ username: "neil", name: "Neo" });
  });

  it("updates profile cache without creating a friend", () => {
    const state = upsertFriendProfile(defaultAppState, {
      username: "Neil",
      name: "Neo",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });

    expect(state.friendProfiles.neil).toMatchObject({ username: "neil", name: "Neo" });
    expect(state.friends.neil).toBeUndefined();
  });

  it("adds a known user locally without requiring a profile request", () => {
    const state = addFriendFromKnownUser(defaultAppState, {
      username: "Neil",
      name: "Neo",
      avatarUrl: "https://linux.do/avatar.png"
    });

    expect(state.friends.neil).toMatchObject({ username: "neil" });
    expect(state.friendProfiles.neil).toMatchObject({
      username: "neil",
      name: "Neo",
      avatarUrl: "https://linux.do/avatar.png"
    });
  });

  it("adds a known user with a looked-up profile without losing profile fields", () => {
    const state = addFriendFromKnownUser(
      defaultAppState,
      { username: "Neil", name: "Fallback" },
      {
        username: "Neil",
        name: "Neo",
        avatarUrl: "https://linux.do/avatar.png",
        lastSeenAt: "2026-06-28T00:01:00.000Z",
        refreshedAt: "2026-06-28T00:02:00.000Z"
      }
    );

    expect(state.friends.neil).toMatchObject({ username: "neil" });
    expect(state.friendProfiles.neil).toMatchObject({
      username: "neil",
      name: "Neo",
      lastSeenAt: "2026-06-28T00:01:00.000Z"
    });
  });

  it("removes cached profile and activity when removing a friend", () => {
    const state = {
      ...addFriendFromProfile(defaultAppState, {
        username: "Neil",
        refreshedAt: "2026-06-28T00:00:00.000Z"
      }),
      activity: {
        neil: {
          username: "neil",
          refreshedAt: "2026-06-27T00:00:00.000Z",
          items: [{ id: "reply:1", username: "neil", kind: "reply" as const, title: "reply" }]
        }
      }
    };

    const next = removeFriend(state, "Neil");

    expect(next.friends.neil).toBeUndefined();
    expect(next.friendProfiles.neil).toBeUndefined();
    expect(next.activity.neil).toBeUndefined();
  });
});
