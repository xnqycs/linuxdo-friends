import { sortActivityItems } from "../domain/activity";
import { latestRefreshForScope, scopeLabel } from "../domain/activityRefresh";
import { normalizeUsername } from "../domain/friends";
import type { ActivityItem, ActivityKindFilter, ActivityRefreshScope, AppState, FollowedUser, FriendProfileSummary, FriendUser, Username } from "../shared/types";

export interface UserIdentityView {
  username: Username;
  primary: string;
  secondary: string;
  avatarUrl?: string;
}

export interface LatestStatusView {
  label: "最后一个帖子" | "最后活动" | "未刷新";
  at?: string;
}

export interface FriendListItem {
  friend: FriendUser;
  identity: UserIdentityView;
  profile?: FriendProfileSummary;
  latestStatus: LatestStatusView;
  activity: AppState["activity"][Username] | undefined;
}

export interface FollowedCandidate {
  user: FollowedUser;
  identity: UserIdentityView;
  isFriend: boolean;
}

export interface FriendCandidate {
  user: FollowedUser;
  identity: UserIdentityView;
  isFriend: boolean;
  isSynthetic?: boolean;
}

export interface FeedFilters {
  kind: ActivityKindFilter;
  username: "all" | Username;
}

export interface ActivityFreshnessView {
  label: string;
  refreshedAt?: string;
}

export type FeedRenderEntry =
  | { type: "activity"; item: ActivityItem }
  | { type: "waterline"; id: string; waterlineAt: string };

export function deriveFriendList(state: AppState): FriendListItem[] {
  return Object.values(state.friends)
    .map((friend) => {
      const profile = state.friendProfiles[friend.username];
      return {
        friend,
        identity: identityForUsername(state, friend.username),
        profile,
        latestStatus: latestStatusForProfile(profile),
        activity: state.activity[friend.username]
      };
    })
    .sort((a, b) => {
      const byLatestStatus = latestStatusTimestamp(b.profile) - latestStatusTimestamp(a.profile);
      if (byLatestStatus !== 0) return byLatestStatus;
      const byAddedAt = timestampValue(b.friend.upgradedAt) - timestampValue(a.friend.upgradedAt);
      if (byAddedAt !== 0) return byAddedAt;
      return a.friend.username.localeCompare(b.friend.username);
    });
}

export function deriveFollowedCandidates(state: AppState): FollowedCandidate[] {
  return Object.values(state.followedUsers)
    .map((user) => ({
      user,
      identity: identityForUsername(state, user.username),
      isFriend: Boolean(state.friends[user.username])
    }))
    .sort((a, b) => Number(b.isFriend) - Number(a.isFriend) || a.user.username.localeCompare(b.user.username));
}

export function orderFollowedCandidates(
  candidates: FollowedCandidate[],
  snapshotOrder?: Username[]
): FollowedCandidate[] {
  if (!snapshotOrder?.length) return candidates;
  const order = new Map(snapshotOrder.map((username, index) => [normalizeUsername(username), index]));
  return [...candidates].sort((a, b) => {
    const bySnapshot = (order.get(a.user.username) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.user.username) ?? Number.MAX_SAFE_INTEGER);
    if (bySnapshot !== 0) return bySnapshot;
    return a.user.username.localeCompare(b.user.username);
  });
}

export function mergeFriendCandidates(
  friends: FriendListItem[],
  followedCandidates: FollowedCandidate[] = []
): FriendCandidate[] {
  const followedUsernames = new Set(followedCandidates.map((candidate) => candidate.user.username));
  const friendOnlyCandidates = friends
    .filter((item) => !followedUsernames.has(item.friend.username))
    .map((item) => ({
      user: {
        username: item.friend.username,
        name: item.identity.primary,
        avatarUrl: item.identity.avatarUrl,
        source: "manual" as const,
        followedAt: item.friend.upgradedAt,
        updatedAt: item.friend.updatedAt
      },
      identity: item.identity,
      isFriend: true
    }));
  return [...friendOnlyCandidates, ...followedCandidates].sort((a, b) => {
    const byFriend = Number(b.isFriend) - Number(a.isFriend);
    if (byFriend !== 0) return byFriend;
    return a.user.username.localeCompare(b.user.username);
  });
}

export function filterFriendCandidates(candidates: FriendCandidate[], query: string): FriendCandidate[] {
  const text = query.trim().toLowerCase();
  if (!text) return candidates;
  return candidates.filter((candidate) =>
    `${candidate.identity.primary} ${candidate.identity.secondary} ${candidate.user.username}`.toLowerCase().includes(text)
  );
}

export function syntheticFriendCandidate(friends: FriendListItem[], candidates: FriendCandidate[], query: string): FriendCandidate | null {
  const username = normalizeUsername(query);
  if (!username || candidates.some((candidate) => candidate.user.username === username)) return null;
  const friend = friends.find((item) => item.friend.username === username);
  return {
    user: { username, source: "manual", followedAt: "", updatedAt: "" },
    identity: friend?.identity ?? identityForRecord({ username }),
    isFriend: Boolean(friend),
    isSynthetic: true
  };
}

export function deriveFeedItems(state: AppState, filters: FeedFilters = { kind: "all", username: "all" }): ActivityItem[] {
  const items = sortActivityItems(
    Object.values(state.activity)
      .filter((summary) => Boolean(state.friends[summary.username]))
      .flatMap((summary) => summary.items)
  );
  return items.filter((item) => {
    if (filters.kind !== "all" && item.kind !== filters.kind) return false;
    if (filters.username !== "all" && (item.actorUsername ?? item.username) !== filters.username) return false;
    return true;
  });
}

export function deriveFeedRenderEntries(state: AppState, filters: FeedFilters = { kind: "all", username: "all" }): FeedRenderEntry[] {
  const items = deriveFeedItems(state, filters);
  const waterlineAt = state.activityFeedWaterlineAt;
  if (!waterlineAt || !items.some((item) => timestampValue(item.occurredAt) > timestampValue(waterlineAt))) {
    return items.map((item) => ({ type: "activity", item }));
  }

  const entries: FeedRenderEntry[] = [];
  let inserted = false;
  for (const item of items) {
    if (!inserted && timestampValue(item.occurredAt) <= timestampValue(waterlineAt)) {
      entries.push({ type: "waterline", id: `waterline:${waterlineAt}`, waterlineAt });
      inserted = true;
    }
    entries.push({ type: "activity", item });
  }
  if (!inserted) {
    entries.push({ type: "waterline", id: `waterline:${waterlineAt}`, waterlineAt });
  }
  return entries;
}

export function deriveFeedUserOptions(state: AppState): UserIdentityView[] {
  return deriveFriendList(state).map((item) => item.identity);
}

export function deriveActivityRefreshScope(filters: FeedFilters): ActivityRefreshScope {
  return {
    kind: filters.kind,
    usernames: filters.username === "all" ? undefined : [filters.username]
  };
}

export function deriveActivityFreshness(state: AppState, scope: ActivityRefreshScope): ActivityFreshnessView {
  const entry = latestRefreshForScope(state.activityRefreshLedger, state, scope);
  return {
    label: `${scopeLabel(scope)} ${entry ? "已刷新" : "未刷新"}`,
    refreshedAt: entry?.refreshedAt
  };
}

export function identityForActivityItem(state: AppState, item: ActivityItem): UserIdentityView {
  const username = item.actorUsername ?? item.username;
  return identityForUsername(state, username, {
    name: item.actorName,
    avatarUrl: item.actorAvatarUrl
  });
}

export function identityForUsername(
  state: AppState,
  usernameInput: Username,
  activityFallback?: { name?: string; avatarUrl?: string }
): UserIdentityView {
  const username = normalizeUsername(usernameInput);
  const profile = state.friendProfiles[username];
  const followed = state.followedUsers[username];
  return identityForRecord({
    username,
    name: activityFallback?.name?.trim() || profile?.name || followed?.name,
    avatarUrl: state.avatarCache[username]?.dataUrl || activityFallback?.avatarUrl || profile?.avatarUrl || followed?.avatarUrl
  });
}

export function identityForFollowedUser(user: Pick<FollowedUser, "username" | "name" | "avatarUrl">): UserIdentityView {
  return identityForRecord(user);
}

export function latestStatusForProfile(profile?: FriendProfileSummary): LatestStatusView {
  if (!profile?.lastPostedAt && !profile?.lastSeenAt) return { label: "未刷新" };
  const posted = timestampValue(profile.lastPostedAt);
  const seen = timestampValue(profile.lastSeenAt);
  if (seen > posted) return { label: "最后活动", at: profile.lastSeenAt };
  return { label: "最后一个帖子", at: profile.lastPostedAt ?? profile.lastSeenAt };
}

function latestStatusTimestamp(profile?: FriendProfileSummary): number {
  if (!profile) return 0;
  return Math.max(timestampValue(profile.lastPostedAt), timestampValue(profile.lastSeenAt));
}

function identityForRecord(user: Pick<FollowedUser, "username" | "name" | "avatarUrl">): UserIdentityView {
  return {
    username: user.username,
    primary: user.name?.trim() || user.username,
    secondary: `@${user.username}`,
    avatarUrl: user.avatarUrl
  };
}

function timestampValue(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
