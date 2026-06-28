import { describe, expect, it } from "vitest";
import { addFriendFromProfile } from "./friends";
import {
  activityRefreshLedgerKey,
  activityRequestStepsForUser,
  activityWatermarkKey,
  applyScopedActivityRefresh,
  clearActivityNewFlags,
  latestActivityRefreshAt,
  latestRefreshForScope,
  planActivityRefreshTargets
} from "./activityRefresh";
import { defaultAppState } from "./defaultState";

describe("activity refresh planning and merge", () => {
  it("plans endpoint steps from activity scope", () => {
    expect(activityRequestStepsForUser("Neil", "topic").map((step) => [step.kind, step.path])).toEqual([
      ["topic", "/user_actions.json?offset=0&username=neil&filter=4"]
    ]);
    expect(activityRequestStepsForUser("Neil", "reply").map((step) => [step.kind, step.path])).toEqual([
      ["reply", "/user_actions.json?offset=0&username=neil&filter=5"]
    ]);
    expect(activityRequestStepsForUser("Neil", "boost").map((step) => step.path)).toEqual([
      "/discourse-boosts/users/neil/boosts-given.json"
    ]);
    expect(activityRequestStepsForUser("Neil", "reaction").map((step) => step.path)).toEqual([
      "/discourse-reactions/posts/reactions.json?username=neil"
    ]);
    expect(activityRequestStepsForUser("Neil", "all").map((step) => step.kind)).toEqual(["user_actions", "boost", "reaction"]);
  });

  it("plans only selected friends and normalizes usernames", () => {
    const state = addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" });

    expect(planActivityRefreshTargets(state, { kind: "boost", usernames: ["ghost", "NEIL"] })).toEqual([
      {
        username: "neil",
        refreshedKinds: ["boost"],
        steps: [
          {
            username: "neil",
            kind: "boost",
            label: "Boost @neil",
            path: "/discourse-boosts/users/neil/boosts-given.json"
          }
        ]
      }
    ]);
  });

  it("merges scoped items without deleting other cached kinds and writes per-kind ledger", () => {
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      activity: {
        neil: {
          username: "neil",
          refreshedAt: "2026-06-27T00:00:00.000Z",
          items: [
            { id: "old-topic", username: "neil", kind: "topic" as const, title: "old topic" },
            { id: "old-boost", username: "neil", kind: "boost" as const, title: "old boost" }
          ]
        }
      }
    };

    const next = applyScopedActivityRefresh(
      state,
      "NEIL",
      [{ id: "new-topic", username: "neil", kind: "topic", title: "new topic", occurredAt: "2026-06-28T00:00:00.000Z" }],
      ["topic"],
      "direct_fetch",
      "2026-06-28T00:01:00.000Z"
    );

    expect(next.activity.neil.items.map((item) => item.id)).toEqual(["new-topic", "old-boost"]);
    expect(next.activityRefreshLedger[activityRefreshLedgerKey("neil", "topic")]).toMatchObject({
      username: "neil",
      kind: "topic",
      refreshedAt: "2026-06-28T00:01:00.000Z",
      source: "direct_fetch",
      itemCount: 1
    });
    expect(next.activityRefreshLedger[activityRefreshLedgerKey("neil", "boost")]).toBeUndefined();
  });

  it("writes watermarks on first refresh without marking historical items new", () => {
    const state = addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" });

    const next = applyScopedActivityRefresh(
      state,
      "NEIL",
      [
        { id: "boost:old", username: "neil", kind: "boost", title: "old boost", occurredAt: "2026-06-28T00:01:00.000Z" },
        { id: "boost:older", username: "neil", kind: "boost", title: "older boost", occurredAt: "2026-06-28T00:00:00.000Z" }
      ],
      ["boost"],
      "direct_fetch",
      "2026-06-28T00:02:00.000Z"
    );

    expect(next.activity.neil.items.map((item) => item.isNew)).toEqual([undefined, undefined]);
    expect(next.activityWatermarks[activityWatermarkKey("neil", "boost")]).toMatchObject({
      scopeKey: "neil:boost",
      username: "neil",
      kind: "boost",
      latestOccurredAt: "2026-06-28T00:01:00.000Z",
      updatedAt: "2026-06-28T00:02:00.000Z",
      source: "direct_fetch"
    });
  });

  it("marks only items newer than the previous user-kind watermark", () => {
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      activityWatermarks: {
        [activityWatermarkKey("neil", "boost")]: {
          scopeKey: "neil:boost",
          username: "neil",
          kind: "boost" as const,
          latestOccurredAt: "2026-06-28T00:01:00.000Z",
          updatedAt: "2026-06-28T00:02:00.000Z",
          source: "direct_fetch" as const
        }
      }
    };

    const next = applyScopedActivityRefresh(
      state,
      "neil",
      [
        { id: "boost:new", username: "neil", kind: "boost", title: "new boost", occurredAt: "2026-06-28T00:03:00.000Z" },
        { id: "boost:old", username: "neil", kind: "boost", title: "old boost", occurredAt: "2026-06-28T00:01:00.000Z" },
        { id: "boost:invalid", username: "neil", kind: "boost", title: "invalid boost", occurredAt: "not-a-date" }
      ],
      ["boost"],
      "direct_fetch",
      "2026-06-28T00:04:00.000Z"
    );

    expect(next.activity.neil.items.map((item) => [item.id, item.isNew])).toEqual([
      ["boost:new", true],
      ["boost:old", undefined],
      ["boost:invalid", undefined]
    ]);
    expect(next.activityWatermarks[activityWatermarkKey("neil", "boost")].latestOccurredAt).toBe("2026-06-28T00:03:00.000Z");
  });

  it("clears stale new flags on every successful refresh and updates only refreshed watermarks", () => {
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      activity: {
        neil: {
          username: "neil",
          refreshedAt: "2026-06-28T00:01:00.000Z",
          items: [
            { id: "old-reaction", username: "neil", kind: "reaction" as const, title: "old reaction", isNew: true },
            { id: "old-topic", username: "neil", kind: "topic" as const, title: "old topic", isNew: true }
          ]
        }
      },
      activityWatermarks: {
        [activityWatermarkKey("neil", "topic")]: {
          scopeKey: "neil:topic",
          username: "neil",
          kind: "topic" as const,
          latestOccurredAt: "2026-06-28T00:01:00.000Z",
          updatedAt: "2026-06-28T00:01:30.000Z",
          source: "direct_fetch" as const
        },
        [activityWatermarkKey("neil", "reaction")]: {
          scopeKey: "neil:reaction",
          username: "neil",
          kind: "reaction" as const,
          latestOccurredAt: "2026-06-28T00:01:00.000Z",
          updatedAt: "2026-06-28T00:01:30.000Z",
          source: "direct_fetch" as const
        }
      }
    };

    const next = applyScopedActivityRefresh(
      state,
      "neil",
      [{ id: "new-topic", username: "neil", kind: "topic", title: "new topic", occurredAt: "2026-06-28T00:03:00.000Z" }],
      ["topic"],
      "direct_fetch",
      "2026-06-28T00:04:00.000Z"
    );

    expect(next.activity.neil.items.map((item) => [item.id, item.isNew])).toEqual([
      ["new-topic", true],
      ["old-reaction", undefined]
    ]);
    expect(next.activityWatermarks[activityWatermarkKey("neil", "topic")].latestOccurredAt).toBe("2026-06-28T00:03:00.000Z");
    expect(next.activityWatermarks[activityWatermarkKey("neil", "reaction")].latestOccurredAt).toBe("2026-06-28T00:01:00.000Z");
  });

  it("can clear activity new flags once for a multi-user refresh batch", () => {
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      activity: {
        neil: {
          username: "neil",
          refreshedAt: "2026-06-28T00:00:00.000Z",
          items: [{ id: "old", username: "neil", kind: "boost" as const, title: "old", isNew: true }]
        }
      }
    };

    expect(clearActivityNewFlags(state).activity.neil.items[0].isNew).toBeUndefined();
  });

  it("uses latest ledger entry inside the current aggregation scope", () => {
    const state = {
      ...addFriendFromProfile(
        addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" }),
        { username: "Ada", refreshedAt: "2026-06-28T00:00:00.000Z" }
      ),
      activityRefreshLedger: {
        [activityRefreshLedgerKey("neil", "boost")]: {
          scopeKey: activityRefreshLedgerKey("neil", "boost"),
          username: "neil",
          kind: "boost" as const,
          refreshedAt: "2026-06-28T00:01:00.000Z",
          source: "direct_fetch" as const,
          itemCount: 1
        },
        [activityRefreshLedgerKey("ada", "boost")]: {
          scopeKey: activityRefreshLedgerKey("ada", "boost"),
          username: "ada",
          kind: "boost" as const,
          refreshedAt: "2026-06-28T00:03:00.000Z",
          source: "direct_fetch" as const,
          itemCount: 1
        }
      }
    };

    expect(latestRefreshForScope(state.activityRefreshLedger, state, { kind: "boost" })?.username).toBe("ada");
    expect(latestRefreshForScope(state.activityRefreshLedger, state, { kind: "boost", usernames: ["Neil"] })?.username).toBe("neil");
    expect(latestActivityRefreshAt(state)).toBe("2026-06-28T00:03:00.000Z");
  });

  it("stores the previous global activity refresh time as the feed waterline", () => {
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      activityRefreshLedger: {
        [activityRefreshLedgerKey("neil", "boost")]: {
          scopeKey: activityRefreshLedgerKey("neil", "boost"),
          username: "neil",
          kind: "boost" as const,
          refreshedAt: "2026-06-28T00:03:00.000Z",
          source: "direct_fetch" as const,
          itemCount: 1
        }
      }
    };

    const next = applyScopedActivityRefresh(
      state,
      "neil",
      [{ id: "boost:new", username: "neil", kind: "boost", title: "new boost", occurredAt: "2026-06-28T00:04:00.000Z" }],
      ["boost"],
      "direct_fetch",
      "2026-06-28T00:05:00.000Z",
      { feedWaterlineAt: latestActivityRefreshAt(state) }
    );

    expect(next.activityFeedWaterlineAt).toBe("2026-06-28T00:03:00.000Z");
  });
});
