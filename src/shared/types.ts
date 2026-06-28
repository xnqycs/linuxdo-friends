export type Username = string;

export interface FollowedUser {
  username: Username;
  name?: string;
  avatarUrl?: string;
  source: "manual" | "sync" | "seed";
  followedAt: string;
  updatedAt: string;
}

export type FollowedUserInput = Pick<FollowedUser, "username" | "name" | "avatarUrl">;

export interface FriendUser {
  username: Username;
  note: string;
  groups: string[];
  pinned: boolean;
  upgradedAt: string;
  updatedAt: string;
}

export interface FriendProfileSummary {
  username: Username;
  name?: string;
  avatarUrl?: string;
  lastPostedAt?: string;
  lastSeenAt?: string;
  refreshedAt: string;
}

export interface AvatarCacheEntry {
  username: Username;
  sourceUrl: string;
  dataUrl: string;
  contentType: string;
  byteLength: number;
  updatedAt: string;
}

export type ActivityKind = "topic" | "reply" | "boost" | "reaction" | "summary";
export type ActivityRefreshKind = Exclude<ActivityKind, "summary">;
export type ActivityKindFilter = "all" | ActivityRefreshKind;
export type ActivityRefreshRequestKind = ActivityRefreshKind | "user_actions";
export type ActivitySource = "user_actions" | "boosts" | "reactions";

export type UiSceneTab = "friends" | "feed";

export interface FilterPopoverScene {
  open: boolean;
  query: string;
}

export interface UiSceneState {
  version: 1;
  tab: UiSceneTab;
  feedKindFilter: ActivityKindFilter;
  feedUserFilter: "all" | Username;
  addFriendModalOpen: boolean;
  addFriendQuery: string;
  activityKindPopover: FilterPopoverScene;
  feedUserPopover: FilterPopoverScene;
}

export interface ActivityItem {
  id: string;
  username: Username;
  kind: ActivityKind;
  title: string;
  url?: string;
  occurredAt?: string;
  excerpt?: string;
  source?: ActivitySource;
  actorUsername?: Username;
  actorName?: string;
  actorAvatarUrl?: string;
  targetUsername?: Username;
  targetName?: string;
  targetAvatarUrl?: string;
  topicId?: number;
  topicTitle?: string;
  postId?: number;
  postNumber?: number;
  replyToPostNumber?: number;
  categoryId?: number;
  reactionValue?: string;
  boostText?: string;
  truncated?: boolean;
  deleted?: boolean;
  hidden?: boolean;
  closed?: boolean;
  archived?: boolean;
  isNew?: boolean;
}

export interface FriendActivitySummary {
  username: Username;
  refreshedAt: string;
  coarseStatus?: "recently_active" | "active_this_week" | "quiet" | "unknown";
  lastPostAt?: string;
  items: ActivityItem[];
}

export interface ActivityRefreshScope {
  kind: ActivityKindFilter;
  usernames?: Username[];
}

export interface ActivityRefreshLedgerEntry {
  scopeKey: string;
  username: Username;
  kind: ActivityRefreshKind;
  refreshedAt: string;
  source: RefreshSource;
  itemCount: number;
}

export interface ActivityWatermarkEntry {
  scopeKey: string;
  username: Username;
  kind: ActivityRefreshKind;
  latestOccurredAt: string;
  updatedAt: string;
  source: RefreshSource;
}

interface BaseSiteDataTaskProgress {
  taskId: string;
  status: "running" | "success" | "error";
  completed: number;
  total: number;
  currentLabel?: string;
  source?: RefreshSource;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
}

export type ActivityRefreshTaskProgress = BaseSiteDataTaskProgress & {
  taskType: "activity";
  scope: ActivityRefreshScope;
};

export type ProfileRefreshTaskProgress = BaseSiteDataTaskProgress & {
  taskType: "profiles";
  usernames: Username[];
};

export type SiteDataTaskProgress = ActivityRefreshTaskProgress | ProfileRefreshTaskProgress;

export interface RefreshSettings {
  allowAutoRefresh: boolean;
  allowInactiveTabFallback: boolean;
  refreshIntervalMinutes: number;
}

export interface CurrentAccount {
  username: Username;
  verifiedAt: string;
  source: "latest_header";
}

export interface AppState {
  followedUsers: Record<Username, FollowedUser>;
  friends: Record<Username, FriendUser>;
  friendProfiles: Record<Username, FriendProfileSummary>;
  activity: Record<Username, FriendActivitySummary>;
  activityRefreshLedger: Record<string, ActivityRefreshLedgerEntry>;
  activityWatermarks: Record<string, ActivityWatermarkEntry>;
  activityFeedWaterlineAt?: string;
  avatarCache: Record<Username, AvatarCacheEntry>;
  settings: RefreshSettings;
  currentAccount?: CurrentAccount;
  lastSync?: RefreshResult;
}

export type PageScriptHeartbeatStatus = "ready" | "challenge" | "unavailable";

export interface PageScriptHeartbeat {
  tabId: number;
  windowId?: number;
  url: string;
  title?: string;
  status: PageScriptHeartbeatStatus;
  hasLauncher: boolean;
  updatedAt: string;
}

export interface PageScriptStatusSnapshot {
  status: "connected" | "challenge" | "stale" | "missing";
  connectedCount: number;
  staleCount: number;
  heartbeats: PageScriptHeartbeat[];
  selectedTabId?: number;
  updatedAt: string;
}

export type ContentScriptHeartbeatMessage = {
  type: "linuxdoFriends.pageHeartbeat";
  url: string;
  title?: string;
  status: PageScriptHeartbeatStatus;
  hasLauncher: boolean;
};

export interface PageRepairResult {
  message: string;
  tabId?: number;
  openedNewTab?: boolean;
}

export type UpdateCheckStatus = "idle" | "checking" | "up-to-date" | "update-available" | "no-release" | "error";

export interface UpdateCheckState {
  installedVersion: string;
  latestReleaseUrl: string;
  status: UpdateCheckStatus;
  latestVersion?: string;
  checkedAt?: string;
  error?: string;
  source?: "github_release";
}

export type RefreshFailureReason =
  | "unavailable"
  | "blocked"
  | "rate_limited"
  | "challenge"
  | "network_error"
  | "invalid_response";

export type RefreshResult =
  | { ok: true; source: RefreshSource; message: string; refreshedAt: string }
  | RefreshFailureResult;

export interface RefreshFailureResult {
  ok: false;
  source: RefreshSource;
  reason: RefreshFailureReason;
  message: string;
  refreshedAt: string;
}

export type RefreshSource = "direct_fetch" | "existing_tab" | "manual";

export type BackgroundCommand =
  | { type: "getState" }
  | { type: "seedFollowedUser"; user: FollowedUserInput }
  | { type: "lookupFriendProfile"; username: Username }
  | { type: "addFriendFromKnownUser"; user: FollowedUserInput; profile?: FriendProfileSummary }
  | { type: "addFriendByProfile"; username: Username }
  | { type: "removeFriend"; username: Username }
  | { type: "updateFriend"; username: Username; patch: Partial<Pick<FriendUser, "note" | "groups" | "pinned">> }
  | { type: "syncFollowedUsers" }
  | { type: "refreshFriendProfiles"; usernames?: Username[] }
  | { type: "refreshFriendActivity"; usernames?: Username[]; scope?: ActivityRefreshScope }
  | { type: "cacheAvatars"; usernames?: Username[] }
  | { type: "getSiteDataProgress" }
  | { type: "getPageScriptStatus" }
  | { type: "getUpdateCheck" }
  | { type: "checkForUpdates"; force?: boolean }
  | { type: "repairLinuxDoPageScript"; tabId?: number }
  | { type: "openSidePanel" }
  | { type: "openOptionsPage" }
  | { type: "openLinuxDoHome" }
  | { type: "updateSettings"; settings: Partial<RefreshSettings> };

export type BackgroundResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; reason?: RefreshFailureReason | "unknown_command" };

export interface VisibleFriend {
  username: Username;
  note: string;
  groups: string[];
  pinned: boolean;
  profile?: FriendProfileSummary;
  activity?: FriendActivitySummary;
}

export type ContentScriptCommand =
  | { type: "linuxdoFriends.extractFollowing" }
  | { type: "linuxdoFriends.extractProfile"; username: Username }
  | { type: "linuxdoFriends.extractActivity"; username: Username; kind?: ActivityKindFilter | "user_actions" }
  | { type: "linuxdoFriends.extractAvatar"; username: Username; avatarUrl: string };

export type ContentScriptFailureResponse = { ok: false; reason: RefreshFailureReason | "unavailable"; error: string };

export type ContentScriptFollowingResponse =
  | { ok: true; username: Username; users: FollowedUserInput[] }
  | ContentScriptFailureResponse;

export type ContentScriptActivityResponse =
  | { ok: true; activity: FriendActivitySummary }
  | ContentScriptFailureResponse;

export type ContentScriptProfileResponse =
  | { ok: true; profile: FriendProfileSummary }
  | ContentScriptFailureResponse;

export type ContentScriptAvatarResponse =
  | { ok: true; username: Username; sourceUrl: string; dataUrl: string; contentType: string; byteLength: number }
  | ContentScriptFailureResponse;

export type ContentScriptResponse =
  | ContentScriptFollowingResponse
  | ContentScriptActivityResponse
  | ContentScriptProfileResponse
  | ContentScriptAvatarResponse;
