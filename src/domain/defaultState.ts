import type { AppState, RefreshSettings } from "../shared/types";

export const defaultSettings: RefreshSettings = {
  allowAutoRefresh: false,
  allowInactiveTabFallback: false,
  refreshIntervalMinutes: 120
};

export const defaultAppState: AppState = {
  followedUsers: {},
  friends: {},
  friendProfiles: {},
  activity: {},
  activityRefreshLedger: {},
  activityWatermarks: {},
  activityFeedWaterlineAt: undefined,
  avatarCache: {},
  settings: defaultSettings
};
