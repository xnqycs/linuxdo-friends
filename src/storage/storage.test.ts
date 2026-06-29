import { describe, expect, it } from "vitest";
import { defaultAppState } from "../domain/defaultState";
import { createMockStorage } from "../test/mockStorage";
import { loadState } from "./storage";

describe("storage migration", () => {
  it("default state includes friendProfiles, activityRefreshLedger, and activityWatermarks", () => {
    expect(defaultAppState.friendProfiles).toEqual({});
    expect(defaultAppState.activityRefreshLedger).toEqual({});
    expect(defaultAppState.activityWatermarks).toEqual({});
    expect(defaultAppState.activityFeedWaterlineAt).toBeUndefined();
    expect(defaultAppState.avatarCache).toEqual({});
  });

  it("backfills old persisted state without friendProfiles", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        followedUsers: {},
        friends: {},
        activity: {},
        settings: { refreshIntervalMinutes: 90 }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      friendProfiles: {},
      activityRefreshLedger: {},
      activityWatermarks: {},
      activityFeedWaterlineAt: undefined,
      avatarCache: {}
    });
  });

  it("preserves persisted activity feed waterline", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        activityFeedWaterlineAt: "2026-06-28T00:00:00.000Z"
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      activityFeedWaterlineAt: "2026-06-28T00:00:00.000Z"
    });
  });

  it("preserves persisted friendProfiles", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        friendProfiles: { neil: { username: "neil", name: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" } }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      friendProfiles: { neil: { username: "neil", name: "Neo" } }
    });
  });

  it("normalizes legacy persisted friends to all activity kinds", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        friends: {
          Neo: {
            username: "@Neo",
            note: "NAS",
            groups: ["ops"],
            pinned: true,
            upgradedAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:01:00.000Z"
          }
        }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      friends: {
        neo: {
          username: "neo",
          activityKinds: ["topic", "reply", "boost", "reaction"]
        }
      }
    });
  });

  it("preserves explicit empty friend activity scope", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        friends: {
          neo: {
            username: "neo",
            activityKinds: [],
            upgradedAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:01:00.000Z"
          }
        }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      friends: { neo: { username: "neo", activityKinds: [] } }
    });
  });

  it("preserves persisted activity refresh ledger", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        activityRefreshLedger: {
          "neil:boost": {
            scopeKey: "neil:boost",
            username: "neil",
            kind: "boost",
            refreshedAt: "2026-06-28T00:00:00.000Z",
            source: "direct_fetch",
            itemCount: 2
          }
        }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      activityRefreshLedger: { "neil:boost": { username: "neil", kind: "boost", itemCount: 2 } }
    });
  });

  it("preserves persisted activity watermarks", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        activityWatermarks: {
          "neil:boost": {
            scopeKey: "neil:boost",
            username: "neil",
            kind: "boost",
            latestOccurredAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:01:00.000Z",
            source: "direct_fetch"
          }
        }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      activityWatermarks: { "neil:boost": { username: "neil", kind: "boost", latestOccurredAt: "2026-06-28T00:00:00.000Z" } }
    });
  });

  it("preserves persisted avatar cache", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        avatarCache: {
          neil: {
            username: "neil",
            sourceUrl: "https://linux.do/user_avatar/linux.do/neil/48/1.png",
            dataUrl: "data:image/png;base64,abc",
            contentType: "image/png",
            byteLength: 3,
            updatedAt: "2026-06-28T00:01:00.000Z"
          }
        }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      avatarCache: { neil: { username: "neil", dataUrl: "data:image/png;base64,abc" } }
    });
  });
});
