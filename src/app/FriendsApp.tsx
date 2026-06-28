import React, { type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useSetAtom } from "jotai";
import {
  ChevronDown,
  ExternalLink,
  List,
  LoaderCircle,
  MessageCircleReply,
  PanelRightOpen,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  Smile,
  Sparkles,
  Users,
  X
} from "lucide-react";
import {
  addFriendFromKnownUserAtom,
  appStateAtom,
  cacheAvatarsAtom,
  clearStatusMessageAtom,
  loadPageScriptStatusAtom,
  loadingAtom,
  loadSiteDataProgressAtom,
  loadStateAtom,
  lookupFriendProfileAtom,
  observeAppStateAtom,
  observePageScriptStatusAtom,
  observeSiteDataProgressAtom,
  openLinuxDoHomeAtom,
  openOptionsPageAtom,
  openSidePanelAtom,
  pageScriptStatusAtom,
  refreshFriendActivityAtom,
  refreshFriendProfilesAtom,
  repairLinuxDoPageScriptAtom,
  removeFriendAtom,
  siteDataProgressAtom,
  statusMessageAtom,
  syncFollowsAtom
} from "../state/atoms";
import { loadUiSceneAtom, observeUiSceneAtom, uiSceneAtom, updateUiSceneAtom } from "../state/uiSceneAtoms";
import { formatRelativeTime } from "../shared/time";
import type {
  ActivityItem,
  ActivityKindFilter,
  ActivityRefreshScope,
  BackgroundResponse,
  FollowedUserInput,
  FriendProfileSummary,
  PageScriptStatusSnapshot,
  SiteDataTaskProgress,
  UiSceneState,
  Username
} from "../shared/types";
import {
  type UserIdentityView,
  deriveActivityFreshness,
  deriveActivityRefreshScope,
  deriveFeedItems,
  deriveFeedRenderEntries,
  deriveFeedUserOptions,
  deriveFollowedCandidates,
  deriveFriendList,
  filterFriendCandidates,
  identityForActivityItem,
  identityForFollowedUser,
  identityForUsername,
  mergeFriendCandidates,
  orderFollowedCandidates,
  syntheticFriendCandidate
} from "../popup/selectors";
import { normalizeUsername } from "../domain/friends";
import "../styles/app.css";

type AppSurface = "side-panel" | "in-page";
type FilterOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  content?: ReactNode;
  searchText?: string;
  tone?: ActivityKindFilter;
};

const RELATIVE_TIME_TICK_MS = 30_000;
const FEED_SCROLL_TOP_GAP = 8;
const AvatarImageContext = React.createContext(false);

const activityKindOptions: Array<FilterOption<ActivityKindFilter>> = [
  { value: "all", label: "全部", icon: <Sparkles size={15} aria-hidden="true" /> },
  { value: "topic", label: "话题", icon: <List size={15} aria-hidden="true" />, tone: "topic" },
  { value: "reply", label: "回复", icon: <MessageCircleReply size={15} aria-hidden="true" />, tone: "reply" },
  { value: "boost", label: "Boost", icon: <Rocket size={15} aria-hidden="true" />, tone: "boost" },
  { value: "reaction", label: "回应", icon: <Smile size={15} aria-hidden="true" />, tone: "reaction" }
];

function scrollTargetBelowSticky(target: HTMLElement) {
  const stickyHeight = stickyTopHeightFor(target);
  const scrollContainer = findScrollContainer(target);
  const targetRect = target.getBoundingClientRect();

  if (scrollContainer) {
    const containerRect = scrollContainer.getBoundingClientRect();
    scrollContainer.scrollTo({
      top: Math.max(0, scrollContainer.scrollTop + targetRect.top - containerRect.top - stickyHeight - FEED_SCROLL_TOP_GAP),
      behavior: "smooth"
    });
    return;
  }

  window.scrollTo({
    top: Math.max(0, window.scrollY + targetRect.top - stickyHeight - FEED_SCROLL_TOP_GAP),
    behavior: "smooth"
  });
}

function stickyTopHeightFor(target: HTMLElement) {
  const root = target.getRootNode();
  const sticky =
    root instanceof Document || root instanceof ShadowRoot
      ? root.querySelector<HTMLElement>(".sticky-top")
      : document.querySelector<HTMLElement>(".sticky-top");
  return sticky?.getBoundingClientRect().height ?? 0;
}

function findScrollContainer(target: HTMLElement) {
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = window.getComputedStyle(parent);
    if ((overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
  }
  return null;
}

export function FriendsApp({ surface = "side-panel" }: { surface?: AppSurface }) {
  const [state] = useAtom(appStateAtom);
  const [loading] = useAtom(loadingAtom);
  const [status] = useAtom(statusMessageAtom);
  const [siteDataProgress] = useAtom(siteDataProgressAtom);
  const [pageScriptStatus] = useAtom(pageScriptStatusAtom);
  const [uiScene] = useAtom(uiSceneAtom);
  const loadState = useSetAtom(loadStateAtom);
  const loadPageScriptStatus = useSetAtom(loadPageScriptStatusAtom);
  const loadSiteDataProgress = useSetAtom(loadSiteDataProgressAtom);
  const loadUiScene = useSetAtom(loadUiSceneAtom);
  const lookupFriendProfile = useSetAtom(lookupFriendProfileAtom);
  const observeAppState = useSetAtom(observeAppStateAtom);
  const observePageScriptStatus = useSetAtom(observePageScriptStatusAtom);
  const observeSiteDataProgress = useSetAtom(observeSiteDataProgressAtom);
  const observeUiScene = useSetAtom(observeUiSceneAtom);
  const addFriendFromKnownUser = useSetAtom(addFriendFromKnownUserAtom);
  const cacheAvatars = useSetAtom(cacheAvatarsAtom);
  const openLinuxDoHome = useSetAtom(openLinuxDoHomeAtom);
  const openOptionsPage = useSetAtom(openOptionsPageAtom);
  const openSidePanel = useSetAtom(openSidePanelAtom);
  const removeFriend = useSetAtom(removeFriendAtom);
  const refreshFriendProfiles = useSetAtom(refreshFriendProfilesAtom);
  const refreshFriendActivity = useSetAtom(refreshFriendActivityAtom);
  const repairLinuxDoPageScript = useSetAtom(repairLinuxDoPageScriptAtom);
  const syncFollows = useSetAtom(syncFollowsAtom);
  const clearStatus = useSetAtom(clearStatusMessageAtom);
  const updateUiScene = useSetAtom(updateUiSceneAtom);
  const [appStateLoaded, setAppStateLoaded] = useState(false);
  const [relativeNow, setRelativeNow] = useState(() => Date.now());
  const { tab, feedKindFilter: kindFilter, feedUserFilter: userFilter, addFriendModalOpen: modalOpen } = uiScene;

  useEffect(() => {
    void loadUiScene();
    void loadState().finally(() => setAppStateLoaded(true));
    void loadPageScriptStatus();
    void loadSiteDataProgress();
    const cleanupAppState = observeAppState();
    const cleanupUiScene = observeUiScene();
    const cleanupPageScriptStatus = observePageScriptStatus();
    const cleanupSiteDataProgress = observeSiteDataProgress();
    return () => {
      cleanupAppState?.();
      cleanupUiScene?.();
      cleanupPageScriptStatus?.();
      cleanupSiteDataProgress?.();
    };
  }, [
    loadPageScriptStatus,
    loadSiteDataProgress,
    loadState,
    loadUiScene,
    observeAppState,
    observePageScriptStatus,
    observeSiteDataProgress,
    observeUiScene
  ]);

  useEffect(() => {
    const interval = window.setInterval(() => setRelativeNow(Date.now()), RELATIVE_TIME_TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  const friends = useMemo(() => deriveFriendList(state), [state]);
  const followedCandidates = useMemo(() => deriveFollowedCandidates(state), [state]);
  const feedUserOptions = useMemo(() => deriveFeedUserOptions(state), [state]);
  const feedItems = useMemo(() => deriveFeedItems(state, { kind: kindFilter, username: userFilter }), [kindFilter, state, userFilter]);
  const feedEntries = useMemo(() => deriveFeedRenderEntries(state, { kind: kindFilter, username: userFilter }), [kindFilter, state, userFilter]);
  const activityRefreshScope = useMemo(() => deriveActivityRefreshScope({ kind: kindFilter, username: userFilter }), [kindFilter, userFilter]);
  const activityFreshness = useMemo(() => deriveActivityFreshness(state, activityRefreshScope), [activityRefreshScope, state]);
  const profileFreshness = useMemo(() => deriveProfileFreshness(friends), [friends]);
  const siteDataTaskRunning = siteDataProgress?.status === "running";
  const refreshDisabled = loading || siteDataTaskRunning || friends.length === 0;

  useEffect(() => {
    if (!appStateLoaded) return;
    if (userFilter === "all" || state.friends[userFilter]) return;
    void updateUiScene({ feedUserFilter: "all" });
  }, [appStateLoaded, state.friends, updateUiScene, userFilter]);

  useEffect(() => {
    if (surface !== "side-panel") return;
    const avatarUsernames = new Set([
      ...Object.keys(state.friends),
      ...Object.keys(state.followedUsers),
      ...Object.keys(state.friendProfiles)
    ]);
    const missingCachedAvatars = [...avatarUsernames].filter((username) => {
      const sourceUrl = state.friendProfiles[username]?.avatarUrl || state.followedUsers[username]?.avatarUrl;
      return sourceUrl && !state.avatarCache[username];
    });
    if (missingCachedAvatars.length === 0) return;
    void cacheAvatars(missingCachedAvatars);
  }, [cacheAvatars, state.avatarCache, state.followedUsers, state.friendProfiles, state.friends, surface]);

  function jumpToUserFeed(username: Username) {
    void updateUiScene({ feedUserFilter: username, tab: "feed" });
    clearStatus();
    void refreshFriendActivity({ kind: kindFilter, usernames: [username] });
  }

  function changeTab(nextTab: typeof uiScene.tab) {
    void updateUiScene({ tab: nextTab });
    clearStatus();
  }

  const statusAction = status ? repairActionForStatus(status, repairLinuxDoPageScript, openLinuxDoHome) : null;

  return (
    <AvatarImageContext.Provider value={surface === "in-page"}>
      <main className={`shell shell-${surface}`}>
        <div className="sticky-top">
          <header className="header">
            <div>
              <p className="eyebrow">LinuxDo Friends</p>
              <h1>佬朋友</h1>
            </div>
            <div className="header-status">
              {surface === "in-page" ? (
                <div className="header-actions">
                  <SidePanelLauncherButton status={pageScriptStatus} onOpen={() => void openSidePanel()} />
                  <OptionsPageButton onOpen={() => void openOptionsPage()} />
                </div>
              ) : (
                <div className="header-actions">
                  <PageScriptStatusBadge status={pageScriptStatus} />
                  <OptionsPageButton onOpen={() => void openOptionsPage()} />
                </div>
              )}
              <span className="badge">{state.currentAccount ? `@${state.currentAccount.username}` : "本地优先"}</span>
            </div>
          </header>

          <section className="tab-bar" aria-label="视图切换">
            <nav className="tabs" aria-label="视图切换">
              <button className={tab === "friends" ? "active" : ""} onClick={() => changeTab("friends")} type="button">
                佬相好
              </button>
              <button className={tab === "feed" ? "active" : ""} onClick={() => changeTab("feed")} type="button">
                佬友圈
              </button>
            </nav>
          </section>

          {status && !modalOpen ? (
            <div className="status" role="status">
              <span>{status}</span>
              {statusAction ? (
                <button className="status-action" type="button" onClick={statusAction.onClick}>
                  {statusAction.label}
                </button>
              ) : null}
              <button className="status-close" type="button" onClick={() => clearStatus()} aria-label="关闭消息">
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>

      {tab === "friends" ? (
        <FriendListTab
          friends={friends}
          loading={loading}
          now={relativeNow}
          onJumpToFeed={jumpToUserFeed}
          onOpenModal={() => void updateUiScene({ addFriendModalOpen: true })}
          onRefresh={() => void refreshFriendProfiles()}
          progress={siteDataProgress}
          profileFreshness={profileFreshness}
          refreshDisabled={refreshDisabled}
        />
      ) : (
        <FeedTab
          activityFreshness={activityFreshness}
          friendsCount={friends.length}
          feedEntries={feedEntries}
          feedItemsCount={feedItems.length}
          kindFilter={kindFilter}
          now={relativeNow}
          onRefresh={() => void refreshFriendActivity(activityRefreshScope)}
          onKindFilterChange={(value) => void updateUiScene({ feedKindFilter: value })}
          onUserFilterChange={(value) => void updateUiScene({ feedUserFilter: value })}
          onActivityKindPopoverChange={(activityKindPopover) => void updateUiScene({ activityKindPopover })}
          onFeedUserPopoverChange={(feedUserPopover) => void updateUiScene({ feedUserPopover })}
          progress={siteDataProgress}
          refreshDisabled={refreshDisabled}
          scope={activityRefreshScope}
          state={state}
          uiScene={uiScene}
          userFilter={userFilter}
          userOptions={feedUserOptions}
        />
      )}

      {modalOpen ? (
        <AddFriendModal
          candidates={followedCandidates}
          currentAccount={state.currentAccount?.username}
          friends={friends}
          loading={loading}
          query={uiScene.addFriendQuery}
          onAdd={(target, profile) => void addFriendFromKnownUser(target, profile)}
          onClose={() => void updateUiScene({ addFriendModalOpen: false })}
          onQueryChange={(query) => void updateUiScene({ addFriendQuery: query })}
          onLookup={(target) => lookupFriendProfile(target)}
          onRemove={(target) => void removeFriend(target)}
          onOpenLinuxDoHome={() => void openLinuxDoHome()}
          onRepairPageScript={() => void repairLinuxDoPageScript()}
          onSync={() => void syncFollows()}
          status={status}
        />
      ) : null}
      </main>
    </AvatarImageContext.Provider>
  );
}

function FriendListTab({
  friends,
  loading,
  now,
  onJumpToFeed,
  onOpenModal,
  onRefresh,
  progress,
  profileFreshness,
  refreshDisabled
}: {
  friends: ReturnType<typeof deriveFriendList>;
  loading: boolean;
  now: number;
  onJumpToFeed: (username: Username) => void;
  onOpenModal: () => void;
  onRefresh: () => void;
  progress: SiteDataTaskProgress | null;
  profileFreshness: { label: string; refreshedAt?: string };
  refreshDisabled: boolean;
}) {
  const profileProgress = progress?.taskType === "profiles" ? progress : null;
  return (
    <section>
      <div className="tab-action-row">
        <button className="refresh-button refresh-button-with-meta" onClick={onRefresh} disabled={refreshDisabled} type="button">
          <RefreshButtonContent
            idleLabel="刷新状态"
            idleMetaMode="freshness"
            now={now}
            progress={profileProgress}
            progressMatches
            freshness={profileFreshness}
          />
        </button>
        <button className="manage-button" onClick={onOpenModal} disabled={loading} type="button">
          我的佬
        </button>
      </div>
      {friends.length === 0 ? (
        <p className="empty">还没有佬朋友。可以手动添加用户名，或从已关注列表里快速添加。</p>
      ) : (
        <div className="list">
          {friends.map(({ friend, identity, latestStatus }) => (
            <article className="friend-split-card" key={friend.username}>
              <a className="friend-main-button" href={profileUrl(friend.username)} target="_blank" rel="noreferrer">
                <UserIdentityRow identity={identity} />
                <div className="latest-status">
                  <span>{latestStatus.label}</span>
                  <small>{formatRelativeTime(latestStatus.at, now)}</small>
                </div>
                {friend.note ? <p className="friend-note">{friend.note}</p> : null}
              </a>
              <button
                className="friend-arrow-button"
                type="button"
                onClick={() => onJumpToFeed(friend.username)}
                aria-label={`查看 @${friend.username} 的朋友圈动态`}
                title="筛选朋友圈"
              >
                ›
              </button>
            </article>
          ))}
        </div>
      )}
      {friends.length > 0 ? <p className="friend-count-footer">共 {friends.length} 位佬朋友</p> : null}
    </section>
  );
}

function FeedTab({
  activityFreshness,
  friendsCount,
  feedEntries,
  feedItemsCount,
  kindFilter,
  now,
  onRefresh,
  onActivityKindPopoverChange,
  onFeedUserPopoverChange,
  onKindFilterChange,
  onUserFilterChange,
  progress,
  refreshDisabled,
  scope,
  state,
  uiScene,
  userFilter,
  userOptions
}: {
  activityFreshness: { label: string; refreshedAt?: string };
  friendsCount: number;
  feedEntries: ReturnType<typeof deriveFeedRenderEntries>;
  feedItemsCount: number;
  kindFilter: ActivityKindFilter;
  now: number;
  onRefresh: () => void;
  onActivityKindPopoverChange: (scene: { open?: boolean; query?: string }) => void;
  onFeedUserPopoverChange: (scene: { open?: boolean; query?: string }) => void;
  onKindFilterChange: (value: ActivityKindFilter) => void;
  onUserFilterChange: (value: "all" | Username) => void;
  progress: SiteDataTaskProgress | null;
  refreshDisabled: boolean;
  scope: ActivityRefreshScope;
  state: Parameters<typeof identityForActivityItem>[0];
  uiScene: UiSceneState;
  userFilter: "all" | Username;
  userOptions: UserIdentityView[];
}) {
  const activityProgress = progress?.taskType === "activity" ? progress : null;
  const feedTopRef = useRef<HTMLElement>(null);
  const selectedIdentity = userFilter === "all" ? undefined : identityForUsername(state, userFilter);
  const userFilterOptions = useMemo<Array<FilterOption<"all" | Username>>>(
    () => [
      { value: "all", label: "全部佬朋友", searchText: "全部佬朋友" },
      ...userOptions.map((identity) => ({
        value: identity.username,
        label: identity.primary,
        content: <UserIdentityRow identity={identity} compact />,
        searchText: `${identity.primary} ${identity.username}`
      }))
    ],
    [userOptions]
  );
  function scrollFeedToTop() {
    if (feedTopRef.current) {
      scrollTargetBelowSticky(feedTopRef.current);
    }
  }

  return (
    <section ref={feedTopRef}>
      <div className="tab-action-row">
        <button className="refresh-button refresh-button-with-meta" onClick={onRefresh} disabled={refreshDisabled} type="button">
          <RefreshButtonContent
            idleLabel="刷新动态"
            idleMetaMode="freshness"
            now={now}
            progress={activityProgress}
            progressMatches={Boolean(activityProgress && sameScope(activityProgress.scope, scope))}
            freshness={activityFreshness}
          />
        </button>
      </div>
      <div className="filters">
        <FilterPopover
          label="类型"
          onChange={onKindFilterChange}
          onOpenChange={(open) => onActivityKindPopoverChange({ open })}
          onQueryChange={(query) => onActivityKindPopoverChange({ query })}
          open={uiScene.activityKindPopover.open}
          options={activityKindOptions}
          query={uiScene.activityKindPopover.query}
          value={kindFilter}
        />
        <FilterPopover
          label="用户"
          onChange={onUserFilterChange}
          onOpenChange={(open) => onFeedUserPopoverChange({ open })}
          onQueryChange={(query) => onFeedUserPopoverChange({ query })}
          open={uiScene.feedUserPopover.open}
          options={userFilterOptions}
          query={uiScene.feedUserPopover.query}
          selectedContent={selectedIdentity ? <UserIdentityRow identity={selectedIdentity} compact /> : undefined}
          value={userFilter}
        />
      </div>

      {friendsCount === 0 ? (
        <p className="empty">还没有佬朋友，朋友圈暂时空着。</p>
      ) : feedItemsCount === 0 ? (
        <p className="empty">暂无匹配动态。可以刷新动态，或换个筛选条件。</p>
      ) : (
        <div className="list">
          {feedEntries.map((entry) =>
            entry.type === "waterline" ? (
              <FeedWaterline key={entry.id} onBackToTop={scrollFeedToTop} />
            ) : (
              <FeedActivityCard item={entry.item} key={entry.item.id} now={now} state={state} />
            )
          )}
        </div>
      )}
    </section>
  );
}

function FeedActivityCard({
  item,
  now,
  state
}: {
  item: ActivityItem;
  now: number;
  state: Parameters<typeof identityForActivityItem>[0];
}) {
  return (
    <article className="feed-card">
      <div className="feed-head">
        <UserIdentityRow identity={identityForActivityItem(state, item)} compact />
        <div className="feed-time">
          {item.isNew ? <span className="new-dot" aria-label="新动态" /> : null}
          <time dateTime={item.occurredAt}>{formatRelativeTime(item.occurredAt, now)}</time>
        </div>
      </div>
      <ActivityCardBody item={item} />
    </article>
  );
}

function FeedWaterline({ onBackToTop }: { onBackToTop: () => void }) {
  return (
    <div className="feed-waterline" role="separator">
      <span>-- 上次更新到此为止，</span>
      <button type="button" onClick={onBackToTop}>
        点我回到顶部
      </button>
      <span> --</span>
    </div>
  );
}

function RefreshButtonContent({
  freshness,
  idleLabel,
  idleMetaMode,
  now,
  progress,
  progressMatches
}: {
  freshness: { label: string; refreshedAt?: string };
  idleLabel: string;
  idleMetaMode: "hidden" | "freshness";
  now: number;
  progress: SiteDataTaskProgress | null;
  progressMatches: boolean;
}) {
  const visibleProgress = progress && progress.status === "running" && progressMatches ? progress : null;
  const percent = visibleProgress?.total ? Math.round((visibleProgress.completed / visibleProgress.total) * 100) : 0;
  const idleMeta =
    idleMetaMode === "hidden"
      ? ""
      : freshness.refreshedAt
        ? `${formatRelativeTime(freshness.refreshedAt, now)}已刷新`
        : freshness.label;
  const progressText = visibleProgress ? (visibleProgress.currentLabel ?? idleLabel) : idleLabel;
  const metaText = visibleProgress ? "" : idleMeta;
  const titleText = visibleProgress
    ? progressText
    : freshness.refreshedAt
      ? `${freshness.label}，${formatRelativeTime(freshness.refreshedAt, now)}已刷新`
      : freshness.label;
  return (
    <span className={`refresh-button-inner${visibleProgress ? " is-running" : ""}${metaText ? " has-meta" : ""}`}>
      <span className="refresh-icon-pane" aria-hidden="true">
        {visibleProgress ? <LoaderCircle className="spin-icon" size={15} aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
      </span>
      <span className="refresh-button-body">
        <span className="refresh-button-main">
          <span className="refresh-button-label" title={visibleProgress ? progressText : undefined}>
            {visibleProgress ? progressText : idleLabel}
          </span>
          {metaText ? (
            <span className="refresh-button-meta" title={titleText}>
              {metaText}
            </span>
          ) : null}
        </span>
      </span>
      {visibleProgress ? (
        <span className="refresh-progress" aria-hidden="true">
          <span className="refresh-progress-track">
            <span style={{ width: `${percent}%` }} />
          </span>
        </span>
      ) : null}
    </span>
  );
}

function ActivityCardBody({ item }: { item: ActivityItem }) {
  const title = item.topicTitle || item.title;
  const href = absoluteLinuxDoUrl(item.url);
  const kindCard = <ActivityKindCard href={href} item={item} />;
  if (item.kind === "boost") {
    return (
      <div className="feed-main">
        {kindCard}
        <div className="feed-primary-block">
          <p className="feed-primary">{item.boostText || "Boost 了帖子"}</p>
          <a className="feed-context-link" href={href} target="_blank" rel="noreferrer">
            <ExternalText text={title} />
          </a>
          {item.excerpt ? <p className="feed-excerpt">{item.excerpt}</p> : null}
        </div>
      </div>
    );
  }
  if (item.kind === "reaction") {
    return (
      <div className="feed-main">
        {kindCard}
        <div className="feed-primary-block">
          <p className="feed-primary">{item.reactionValue ? `回应了 ${item.reactionValue}` : "回应了帖子"}</p>
          <a className="feed-context-link" href={href} target="_blank" rel="noreferrer">
            <ExternalText text={title} />
          </a>
          {item.excerpt ? <p className="feed-excerpt">{item.excerpt}</p> : null}
        </div>
      </div>
    );
  }
  if (item.kind === "reply") {
    return (
      <div className="feed-main">
        {kindCard}
        <div className="feed-primary-block">
          {item.excerpt ? <p className="feed-primary">{item.excerpt}</p> : <p className="feed-primary">回复了话题</p>}
          <a className="feed-context-link" href={href} target="_blank" rel="noreferrer">
            <ExternalText text={title} />
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="feed-main">
      {kindCard}
      <div className="feed-primary-block">
        <a className="feed-title" href={href} target="_blank" rel="noreferrer">
          <ExternalText text={title} />
        </a>
        {item.excerpt ? <p className="feed-excerpt">{item.excerpt}</p> : null}
      </div>
    </div>
  );
}

function ActivityKindCard({ href, item }: { href: string; item: ActivityItem }) {
  return (
    <a className={`kind-card kind-${item.kind}`} href={href} target="_blank" rel="noreferrer" title={`打开${kindText(item.kind)}动态`}>
      <span className="kind-card-icon">{kindIcon(item.kind, 15)}</span>
      <span className="kind-card-label">{kindText(item.kind)}</span>
      {item.kind === "reply" && item.replyToPostNumber ? <span className="kind-card-floor">#{item.replyToPostNumber}</span> : null}
      <span className="kind-card-link">
        <ExternalLink size={12} aria-hidden="true" />
      </span>
    </a>
  );
}

function FilterPopover<T extends string>({
  label,
  onChange,
  onOpenChange,
  onQueryChange,
  open,
  options,
  query,
  selectedContent,
  value
}: {
  label: string;
  onChange: (value: T) => void;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  open: boolean;
  options: Array<FilterOption<T>>;
  query: string;
  selectedContent?: ReactNode;
  value: T;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const selected = options.find((option) => option.value === value) ?? options[0];
  const filtered = normalizedQuery ? options.filter((option) => optionSearchText(option).includes(normalizedQuery)) : options;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (popoverRef.current && !eventHappenedInside(event, popoverRef.current)) {
        onOpenChange(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenChange, open]);

  return (
    <div className="filter-popover" ref={popoverRef}>
      <span>{label}</span>
      <button
        className="filter-popover-trigger"
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
      >
        <span className="filter-popover-value">{selectedContent ?? optionContent(selected)}</span>
        <ChevronDown className="filter-popover-arrow" size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="filter-popover-menu">
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={`搜索${label}`} />
          {filtered.map((option) => (
            <button
              className={value === option.value ? "active" : ""}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                onOpenChange(false);
              }}
              type="button"
            >
              {optionContent(option)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function eventHappenedInside(event: Event, element: HTMLElement) {
  const path = event.composedPath();
  if (path.length > 0) {
    return path.includes(element);
  }
  return element.contains(event.target as Node | null);
}

function ExternalText({ text }: { text: string }) {
  return (
    <span className="external-text">
      <span>{text}</span>
      <ExternalLink size={12} aria-hidden="true" />
    </span>
  );
}

function AddFriendModal({
  candidates,
  currentAccount,
  friends,
  loading,
  query,
  onAdd,
  onClose,
  onQueryChange,
  onLookup,
  onOpenLinuxDoHome,
  onRemove,
  onRepairPageScript,
  onSync,
  status
}: {
  candidates: ReturnType<typeof deriveFollowedCandidates>;
  currentAccount?: Username;
  friends: ReturnType<typeof deriveFriendList>;
  loading: boolean;
  query: string;
  onAdd: (user: FollowedUserInput, profile?: FriendProfileSummary) => void;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onLookup: (username: Username) => Promise<BackgroundResponse<FriendProfileSummary>>;
  onOpenLinuxDoHome: () => void;
  onRemove: (username: Username) => void;
  onRepairPageScript: () => void;
  onSync: () => void;
  status: string | null;
}) {
  const [lookupProfiles, setLookupProfiles] = useState<Record<Username, FriendProfileSummary>>({});
  const [lookupErrors, setLookupErrors] = useState<Record<Username, string>>({});
  const [lookupPending, setLookupPending] = useState<Username | null>(null);
  const baseCandidates = useMemo(() => mergeFriendCandidates(friends, candidates), [candidates, friends]);
  const [snapshotOrder] = useState(() => baseCandidates.map((candidate) => candidate.user.username));
  const orderedCandidates = useMemo(() => orderFollowedCandidates(baseCandidates, snapshotOrder), [baseCandidates, snapshotOrder]);
  const filteredCandidates = useMemo(() => filterFriendCandidates(orderedCandidates, query), [orderedCandidates, query]);
  const syntheticCandidate = useMemo(() => {
    const candidate = syntheticFriendCandidate(friends, orderedCandidates, query);
    if (!candidate) return null;
    const profile = lookupProfiles[candidate.user.username];
    if (!profile) return candidate;
    const username = normalizeUsername(profile.username);
    return {
      user: {
        username,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        source: "manual" as const,
        followedAt: "",
        updatedAt: profile.refreshedAt
      },
      identity: identityForFollowedUser(profile),
      isFriend: friends.some((item) => item.friend.username === username),
      isSynthetic: true
    };
  }, [friends, lookupProfiles, orderedCandidates, query]);
  const visibleCandidates = syntheticCandidate ? [syntheticCandidate, ...filteredCandidates] : filteredCandidates;
  const statusAction = status ? repairActionForStatus(status, onRepairPageScript, onOpenLinuxDoHome) : null;
  const actionDisabled = loading || lookupPending != null;

  async function handleLookup(usernameInput: Username) {
    const username = normalizeUsername(usernameInput);
    if (!username || lookupPending) return;
    setLookupPending(username);
    setLookupErrors((current) => omitKey(current, username));
    const response = await onLookup(username);
    setLookupPending(null);
    if (response.ok) {
      const resolvedUsername = normalizeUsername(response.data.username);
      const profile = { ...response.data, username: resolvedUsername };
      setLookupProfiles((current) => ({
        ...current,
        [username]: profile,
        [resolvedUsername]: profile
      }));
      setLookupErrors((current) => omitKeys(current, [username, resolvedUsername]));
    } else {
      setLookupErrors((current) => ({
        ...current,
        [username]: response.error || "用户不存在或公开资料不可用。"
      }));
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="followed-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">管理</p>
            <h2 id="followed-title">我的佬朋友</h2>
          </div>
          <button
            className="small-action"
            onClick={onSync}
            disabled={loading}
            title={currentAccount ? `获取 @${currentAccount} 的关注列表` : "需要先在 linux.do 登录"}
            type="button"
          >
            <RefreshCw className={loading ? "spin-icon" : undefined} size={13} aria-hidden="true" />
            获取我的关注列表
          </button>
          <button className="icon-button" onClick={onClose} type="button" aria-label="关闭">
            ×
          </button>
        </div>
        {status ? (
          <div className="modal-status" role="status">
            <span>{status}</span>
            {statusAction ? (
              <button className="status-action" type="button" onClick={statusAction.onClick}>
                {statusAction.label}
              </button>
            ) : null}
          </div>
        ) : !currentAccount ? (
          <div className="modal-status modal-status-warning" role="status">
            <span>需要先在浏览器里登录 linux.do，识别到用户名后才能获取我的关注列表。</span>
            <button className="status-action" type="button" onClick={onOpenLinuxDoHome}>
              打开 linux.do
            </button>
          </div>
        ) : null}

        <section className="modal-section">
          <input
            className="modal-search-input"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="筛选已关注，或输入用户名"
            autoFocus
          />
          {visibleCandidates.length === 0 ? (
            <p className="empty">没有匹配项。输入完整用户名后先查找用户。</p>
          ) : (
            <div className="list modal-list">
              {visibleCandidates.map((candidate) => (
                <div className="candidate-row" key={candidate.user.username}>
                  <UserIdentityRow identity={candidate.identity} />
                  <CandidateAction
                    candidate={candidate}
                    disabled={actionDisabled}
                    lookupError={lookupErrors[candidate.user.username]}
                    lookupPending={lookupPending === candidate.user.username}
                    lookupVerified={Boolean(lookupProfiles[candidate.user.username])}
                    onAdd={(user) => onAdd(user, lookupProfiles[user.username])}
                    onLookup={handleLookup}
                    onRemove={onRemove}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

function CandidateAction({
  candidate,
  disabled,
  lookupError,
  lookupPending,
  lookupVerified,
  onAdd,
  onLookup,
  onRemove
}: {
  candidate: ReturnType<typeof mergeFriendCandidates>[number];
  disabled: boolean;
  lookupError?: string;
  lookupPending: boolean;
  lookupVerified: boolean;
  onAdd: (user: FollowedUserInput) => void;
  onLookup: (username: Username) => void;
  onRemove: (username: Username) => void;
}) {
  if (candidate.isFriend) {
    return (
      <button className="candidate-action-remove" onClick={() => onRemove(candidate.user.username)} disabled={disabled} type="button">
        移除
      </button>
    );
  }

  if (candidate.isSynthetic && !lookupVerified) {
    if (lookupError) {
      return (
        <span className="candidate-lookup-status" title={lookupError}>
          {lookupError}
        </span>
      );
    }
    return (
      <button className="candidate-action-lookup" onClick={() => onLookup(candidate.user.username)} disabled={disabled} type="button">
        {lookupPending ? <LoaderCircle className="spin-icon" size={13} aria-hidden="true" /> : <Search size={13} aria-hidden="true" />}
        {lookupPending ? "查找中" : "查找用户"}
      </button>
    );
  }

  return (
    <button className="candidate-action-add" onClick={() => onAdd(candidate.user)} disabled={disabled} type="button">
      视奸 ta
    </button>
  );
}

function omitKey<T>(record: Record<Username, T>, key: Username): Record<Username, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function omitKeys<T>(record: Record<Username, T>, keys: Username[]): Record<Username, T> {
  let next = record;
  for (const key of keys) {
    next = omitKey(next, key);
  }
  return next;
}

function PageScriptStatusBadge({ status }: { status: PageScriptStatusSnapshot }) {
  const label = pageScriptStatusLabel(status);
  return (
    <span className={`page-script-badge page-script-${status.status}`} title={pageScriptStatusTitle(status)}>
      <span aria-hidden="true" />
      {label}
    </span>
  );
}

function SidePanelLauncherButton({ status, onOpen }: { status: PageScriptStatusSnapshot; onOpen: () => void }) {
  return (
    <button className={`header-icon-chip side-panel-chip page-script-${status.status}`} type="button" onClick={onOpen} title="打开浏览器侧栏" aria-label="打开浏览器侧栏">
      <PanelRightOpen size={14} aria-hidden="true" />
    </button>
  );
}

function OptionsPageButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button className="header-icon-chip settings-chip" type="button" onClick={onOpen} title="打开配置页" aria-label="打开配置页">
      <Settings size={14} aria-hidden="true" />
    </button>
  );
}

function pageScriptStatusLabel(status: PageScriptStatusSnapshot) {
  if (status.status === "connected") return `关联会话 ${status.connectedCount}`;
  if (status.status === "challenge") return "页面验证";
  if (status.status === "stale") return "页面断开";
  return "页面未连";
}

function pageScriptStatusTitle(status: PageScriptStatusSnapshot) {
  const latest = status.heartbeats[0];
  if (!latest) return "还没有 linux.do 页面脚本心跳。";
  return `最近页面：${latest.title || latest.url}`;
}

function repairActionForStatus(status: string, onRepairPageScript: () => void, onOpenLinuxDoHome: () => void) {
  if (status.includes("未加载佬朋友脚本") || status.includes("没有响应")) {
    return { label: "一键刷新页面", onClick: onRepairPageScript };
  }
  if (status.includes("浏览器验证") || status.includes("请打开一个 linux.do 页面")) {
    return { label: "打开 linux.do", onClick: onOpenLinuxDoHome };
  }
  return null;
}

function UserIdentityRow({ identity, compact = false }: { identity: UserIdentityView; compact?: boolean }) {
  const allowRemoteAvatar = useContext(AvatarImageContext);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const shouldRenderImage = identity.avatarUrl && (allowRemoteAvatar || identity.avatarUrl.startsWith("data:image/")) && !avatarFailed;

  useEffect(() => {
    setAvatarFailed(false);
  }, [identity.avatarUrl]);

  return (
    <div className={`identity-row${compact ? " compact-identity" : ""}`}>
      {shouldRenderImage ? (
        <img className="avatar" src={identity.avatarUrl} alt="" onError={() => setAvatarFailed(true)} />
      ) : (
        <span className="avatar avatar-fallback" aria-hidden="true">
          {identity.username.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="identity-text">
        <strong>{identity.primary}</strong>
        <span>{identity.secondary}</span>
      </div>
    </div>
  );
}

function optionContent<T extends string>(option: FilterOption<T>) {
  return option.content ?? (
    <span className="filter-option-content">
      {option.tone ? <span className={`filter-option-icon kind-${option.tone}`}>{option.icon}</span> : option.icon}
      {option.label}
    </span>
  );
}

function optionSearchText<T extends string>(option: FilterOption<T>) {
  return (option.searchText ?? `${option.label} ${option.value}`).toLowerCase();
}

function kindText(kind: ActivityItem["kind"]) {
  if (kind === "topic") return "话题";
  if (kind === "reply") return "回复";
  if (kind === "boost") return "Boost";
  if (kind === "reaction") return "回应";
  return "动态";
}

function kindIcon(kind: ActivityItem["kind"], size = 15) {
  if (kind === "topic") return <List size={size} aria-hidden="true" />;
  if (kind === "reply") return <MessageCircleReply size={size} aria-hidden="true" />;
  if (kind === "boost") return <Rocket size={size} aria-hidden="true" />;
  if (kind === "reaction") return <Smile size={size} aria-hidden="true" />;
  return <Users size={size} aria-hidden="true" />;
}

function sameScope(left: ActivityRefreshScope, right: ActivityRefreshScope) {
  if (left.kind !== right.kind) return false;
  return normalizedScopeUsers(left).join(",") === normalizedScopeUsers(right).join(",");
}

function normalizedScopeUsers(scope: ActivityRefreshScope) {
  return [...(scope.usernames ?? [])].map((username) => username.trim().replace(/^@/, "").toLowerCase()).sort();
}

function deriveProfileFreshness(friends: ReturnType<typeof deriveFriendList>): { label: string; refreshedAt?: string } {
  const timestamps = friends.flatMap(({ profile }) => (profile?.refreshedAt ? [profile.refreshedAt] : []));
  if (timestamps.length === 0) {
    return { label: friends.length ? "尚未刷新状态" : "暂无佬朋友" };
  }
  return {
    label: "状态",
    refreshedAt: timestamps.sort((left, right) => Date.parse(right) - Date.parse(left))[0]
  };
}

function absoluteLinuxDoUrl(url?: string) {
  if (!url) return "https://linux.do";
  if (url.startsWith("http")) return url;
  return `https://linux.do${url}`;
}

function profileUrl(username: Username) {
  return `https://linux.do/u/${encodeURIComponent(username)}`;
}
