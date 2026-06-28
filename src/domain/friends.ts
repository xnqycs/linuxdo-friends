import { nowIso } from "../shared/time";
import type { AppState, FollowedUser, FriendProfileSummary, FriendUser, Username } from "../shared/types";

export function normalizeUsername(username: string): Username {
  return username.trim().replace(/^@/, "").toLowerCase();
}

export function upsertFollowedUser(
  state: AppState,
  user: Pick<FollowedUser, "username" | "name" | "avatarUrl"> & Partial<Pick<FollowedUser, "source">>
): AppState {
  const username = normalizeUsername(user.username);
  const existing = state.followedUsers[username];
  const timestamp = nowIso();
  return {
    ...state,
    followedUsers: {
      ...state.followedUsers,
      [username]: {
        username,
        name: user.name,
        avatarUrl: user.avatarUrl,
        source: user.source ?? existing?.source ?? "manual",
        followedAt: existing?.followedAt ?? timestamp,
        updatedAt: timestamp
      }
    }
  };
}

export function addFriendFromProfile(state: AppState, profileInput: FriendProfileSummary): AppState {
  const username = normalizeUsername(profileInput.username);
  const existing = state.friends[username];
  const timestamp = nowIso();
  const friend: FriendUser = {
    username,
    note: existing?.note ?? "",
    groups: existing?.groups ?? [],
    pinned: existing?.pinned ?? false,
    upgradedAt: existing?.upgradedAt ?? timestamp,
    updatedAt: timestamp
  };
  return {
    ...state,
    friends: {
      ...state.friends,
      [username]: friend
    },
    friendProfiles: {
      ...state.friendProfiles,
      [username]: {
        ...profileInput,
        username
      }
    }
  };
}

export function addFriendFromKnownUser(
  state: AppState,
  userInput: Pick<FollowedUser, "username" | "name" | "avatarUrl">,
  profileInput?: FriendProfileSummary
): AppState {
  if (profileInput) return addFriendFromProfile(state, profileInput);
  const username = normalizeUsername(userInput.username);
  if (!username) return state;
  const existing = state.friends[username];
  const existingProfile = state.friendProfiles[username];
  const timestamp = nowIso();
  return {
    ...state,
    friends: {
      ...state.friends,
      [username]: {
        username,
        note: existing?.note ?? "",
        groups: existing?.groups ?? [],
        pinned: existing?.pinned ?? false,
        upgradedAt: existing?.upgradedAt ?? timestamp,
        updatedAt: timestamp
      }
    },
    friendProfiles: existingProfile || userInput.name || userInput.avatarUrl
      ? {
          ...state.friendProfiles,
          [username]: {
            username,
            name: existingProfile?.name ?? userInput.name,
            avatarUrl: existingProfile?.avatarUrl ?? userInput.avatarUrl,
            lastPostedAt: existingProfile?.lastPostedAt,
            lastSeenAt: existingProfile?.lastSeenAt,
            refreshedAt: existingProfile?.refreshedAt ?? timestamp
          }
        }
      : state.friendProfiles
  };
}

export function upsertFriendProfile(state: AppState, profileInput: FriendProfileSummary): AppState {
  const username = normalizeUsername(profileInput.username);
  return {
    ...state,
    friendProfiles: {
      ...state.friendProfiles,
      [username]: {
        ...profileInput,
        username
      }
    }
  };
}

export function updateFriend(
  state: AppState,
  usernameInput: Username,
  patch: Partial<Pick<FriendUser, "note" | "groups" | "pinned">>
): AppState {
  const username = normalizeUsername(usernameInput);
  const existing = state.friends[username];
  if (!existing) return state;
  return {
    ...state,
    friends: {
      ...state.friends,
      [username]: {
        ...existing,
        ...patch,
        groups: patch.groups ?? existing.groups,
        updatedAt: nowIso()
      }
    }
  };
}

export function removeFriend(state: AppState, usernameInput: Username): AppState {
  const username = normalizeUsername(usernameInput);
  const { [username]: _removed, ...friends } = state.friends;
  const { [username]: _removedProfile, ...friendProfiles } = state.friendProfiles;
  const { [username]: _removedActivity, ...activity } = state.activity;
  return {
    ...state,
    friends,
    friendProfiles,
    activity
  };
}

export function getFriendView(state: AppState) {
  return Object.values(state.friends)
    .map((friend) => ({
      username: friend.username,
      note: friend.note,
      groups: friend.groups,
      pinned: friend.pinned,
      profile: state.friendProfiles[friend.username],
      activity: state.activity[friend.username]
    }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.username.localeCompare(b.username));
}
