import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { FriendsApp } from "../app/FriendsApp";
import type { AppState } from "../shared/types";
import type {
  ActivityItem,
  ActivityKindFilter,
  ActivityRefreshKind,
  ActivityRefreshRequestKind,
  ContentScriptActivityResponse,
  ContentScriptAvatarResponse,
  ContentScriptCommand,
  ContentScriptCurrentAccountResponse,
  ContentScriptFollowingResponse,
  ContentScriptProfileResponse,
  ContentScriptResponse,
  FollowedUserInput,
  FriendActivitySummary,
  FriendProfileSummary,
  RefreshFailureReason,
  Username
} from "../shared/types";
import appCss from "../styles/app.css?inline";

const markerClass = "linuxdo-friends-marker";
const friendAvatarClass = "linuxdo-friends-friend-avatar";
const friendNameMarkClass = "linuxdo-friends-name-mark";
const launcherId = "linuxdo-friends-launcher";
const pageStyleId = "linuxdo-friends-page-style";
const userMenuTabId = "linuxdo-friends-user-menu-tab";
const userMenuPanelId = "linuxdo-friends-user-menu-panel";
const userMenuActiveClass = "linuxdo-friends-user-menu-active";
const userMenuDrawerClass = "linuxdo-friends-user-menu-drawer";
const userMenuHiddenAttr = "data-linuxdo-friends-menu-hidden";
const userMenuPreviousDisplayAttr = "data-linuxdo-friends-previous-display";
const heartbeatIntervalMs = 15_000;

let userMenuRoot: Root | null = null;
let userMenuObserver: MutationObserver | null = null;
let userMenuEnhanceTimer: number | null = null;
let launcherPlacementTimer: number | null = null;
let friendMarkerTimer: number | null = null;
let suppressFriendMarkerMutations = false;
let heartbeatTimer: number | null = null;
let lastHeartbeatStatus: "pending" | "connected" | "disconnected" = "pending";
let latestState: AppState | null = null;

void init();
subscribeToStorageChanges();
subscribeToRuntimeMessages();
startHeartbeat();
startUserMenuIntegration();
startRouteTracking();

async function init() {
  const state = await getState();
  ensurePageStyle();
  ensureLauncher();
  if (!state) return;
  latestState = state;
  markFriends(state);
}

async function getState(): Promise<AppState | null> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "getState" });
    return response?.ok ? response.data : null;
  } catch {
    return null;
  }
}

export function markFriends(state: AppState) {
  ensurePageStyle();
  suppressFriendMarkerMutations = true;
  clearMarkers();
  const friends = Object.keys(state.friends);
  try {
    if (friends.length === 0) return;
    const friendSet = new Set(friends);
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/u/"], a[href*="linux.do/u/"]'));
    for (const link of links) {
      const username = extractUsername(link);
      if (!username || !friendSet.has(username) || !isProfileIdentityLink(link)) continue;
      markAvatarElements(link);
      markNameText(link, getFriendDisplayName(state, username));
    }
  } finally {
    window.setTimeout(() => {
      suppressFriendMarkerMutations = false;
    }, 0);
  }
}

export function ensureLauncher() {
  let launcher = document.getElementById(launcherId) as HTMLButtonElement | null;
  if (!launcher) {
    launcher = document.createElement("button");
    launcher.id = launcherId;
    launcher.type = "button";
    launcher.className = "btn no-text icon btn-flat";
    launcher.title = "佬朋友";
    launcher.setAttribute("aria-label", "打开佬朋友");
    launcher.innerHTML = discourseFriendIconSvg();
    launcher.append(createLauncherStatusDot());
    updateLauncherStatusDot(lastHeartbeatStatus);
    launcher.addEventListener("click", () => {
      void openFriendsUserMenu();
    });
  }

  if (!placeLauncher(launcher)) {
    dockLauncherToFallback(launcher);
  }
  sendHeartbeat();
}

function ensurePageStyle() {
  if (document.getElementById(pageStyleId)) return;
  const style = document.createElement("style");
  style.id = pageStyleId;
  style.textContent = `
    :root {
      --linuxdo-friends-accent: #5eead4;
      --linuxdo-friends-accent-soft: rgba(94, 234, 212, 0.28);
      --linuxdo-friends-accent-glow: rgba(94, 234, 212, 0.52);
    }

    .${friendNameMarkClass} {
      position: relative !important;
      display: inline-block !important;
      isolation: isolate !important;
      padding-inline: 1ch !important;
      margin-inline: -1ch !important;
      text-decoration: inherit !important;
    }

    .${friendNameMarkClass}::before {
      content: "" !important;
      position: absolute !important;
      z-index: -1 !important;
      left: 0 !important;
      right: 0 !important;
      top: 56% !important;
      height: 34% !important;
      border-radius: 999px 8px 999px 10px / 8px 999px 10px 999px !important;
      background:
        linear-gradient(
          100deg,
          transparent 0%,
          color-mix(in srgb, var(--linuxdo-friends-accent) 20%, transparent) 10%,
          color-mix(in srgb, var(--linuxdo-friends-accent) 40%, transparent) 47%,
          color-mix(in srgb, var(--linuxdo-friends-accent) 22%, transparent) 88%,
          transparent 100%
        ) !important;
      filter: blur(0.25px) !important;
      transform: rotate(-1.2deg) !important;
      pointer-events: none !important;
    }

    .${friendAvatarClass} {
      border-radius: 999px !important;
      animation: linuxdo-friends-avatar-breathe 2.2s ease-in-out infinite !important;
      box-shadow:
        0 0 0 1px color-mix(in srgb, var(--linuxdo-friends-accent) 34%, transparent),
        0 0 12px color-mix(in srgb, var(--linuxdo-friends-accent) 46%, transparent),
        0 0 30px color-mix(in srgb, var(--linuxdo-friends-accent) 34%, transparent),
        0 0 52px color-mix(in srgb, var(--linuxdo-friends-accent) 20%, transparent) !important;
    }

    @keyframes linuxdo-friends-avatar-breathe {
      0%, 100% {
        box-shadow:
          0 0 0 1px color-mix(in srgb, var(--linuxdo-friends-accent) 22%, transparent),
          0 0 8px color-mix(in srgb, var(--linuxdo-friends-accent) 24%, transparent),
          0 0 20px color-mix(in srgb, var(--linuxdo-friends-accent) 16%, transparent),
          0 0 34px color-mix(in srgb, var(--linuxdo-friends-accent) 8%, transparent);
      }
      50% {
        box-shadow:
          0 0 0 2px color-mix(in srgb, var(--linuxdo-friends-accent) 46%, transparent),
          0 0 16px color-mix(in srgb, var(--linuxdo-friends-accent) 62%, transparent),
          0 0 38px color-mix(in srgb, var(--linuxdo-friends-accent) 46%, transparent),
          0 0 68px color-mix(in srgb, var(--linuxdo-friends-accent) 28%, transparent);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .${friendAvatarClass} {
        animation: none !important;
      }
    }

    #${userMenuPanelId} {
      display: block;
      flex: 0 0 min(320px, calc(100vw - 64px));
      width: min(320px, calc(100vw - 64px));
      max-width: 100%;
      min-width: 0;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background: #101414;
    }

    .user-menu.${userMenuActiveClass} .panel-body,
    .user-menu.${userMenuActiveClass} .panel-body-contents {
      min-width: 0;
    }

    .user-menu.${userMenuActiveClass} .panel-body-contents {
      overflow: hidden;
    }

    .user-menu.${userMenuActiveClass} .panel-body-contents > .menu-tabs-container {
      flex: 0 0 46px;
    }

    .user-menu.${userMenuActiveClass}.${userMenuDrawerClass} #${userMenuPanelId} {
      flex: 1 1 calc(100% - 46px);
      width: calc(100% - 46px);
      max-width: calc(100% - 46px);
    }
  `;
  document.documentElement.append(style);
}

function startUserMenuIntegration() {
  ensurePageStyle();
  scheduleUserMenuEnhancement();
  scheduleLauncherPlacement();
  if (userMenuObserver) return;
  userMenuObserver = new MutationObserver(() => {
    scheduleUserMenuEnhancement();
    scheduleLauncherPlacement();
    if (!suppressFriendMarkerMutations) scheduleFriendMarkers();
  });
  userMenuObserver.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("load", () => scheduleLauncherPlacement(), { once: true });
}

function startRouteTracking() {
  window.addEventListener("popstate", () => scheduleFriendMarkers());
  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");
}

function wrapHistoryMethod(method: "pushState" | "replaceState") {
  const original = window.history[method];
  window.history[method] = function patchedHistoryMethod(this: History, ...args: Parameters<History[typeof method]>) {
    const result = original.apply(this, args);
    scheduleFriendMarkers();
    return result;
  } as History[typeof method];
}

function scheduleFriendMarkers() {
  if (typeof window === "undefined" || !latestState) return;
  if (friendMarkerTimer != null) return;
  friendMarkerTimer = window.setTimeout(() => {
    friendMarkerTimer = null;
    if (latestState) markFriends(latestState);
  }, 80);
}

function scheduleUserMenuEnhancement() {
  if (typeof window === "undefined") return;
  if (userMenuEnhanceTimer != null) return;
  userMenuEnhanceTimer = window.setTimeout(() => {
    userMenuEnhanceTimer = null;
    enhanceUserMenu();
  }, 0);
}

function scheduleLauncherPlacement() {
  if (typeof window === "undefined") return;
  if (launcherPlacementTimer != null) return;
  launcherPlacementTimer = window.setTimeout(() => {
    launcherPlacementTimer = null;
    refreshLauncherPlacement();
  }, 0);
}

function refreshLauncherPlacement() {
  const launcher = document.getElementById(launcherId) as HTMLButtonElement | null;
  if (!launcher) {
    ensureLauncher();
    return;
  }
  if (!placeLauncher(launcher)) {
    dockLauncherToFallback(launcher);
  }
}

export function enhanceUserMenu() {
  const menu = findUserMenu();
  if (!menu) {
    unmountUserMenuPanel();
    return;
  }

  const tabs = findUserMenuTopTabs(menu);
  const contents = findUserMenuContents(menu);
  if (!tabs || !contents) return;

  if (!menu.dataset.linuxdoFriendsTabsBound) {
    menu.dataset.linuxdoFriendsTabsBound = "true";
    tabs.closest(".menu-tabs-container")?.addEventListener(
      "click",
      (event) => {
        const tab = (event.target as Element | null)?.closest<HTMLElement>(".user-menu-tab");
        if (tab && tab.id !== userMenuTabId) {
          closeUserMenuPanel(menu);
        }
      },
      true
    );
  }

  if (!document.getElementById(userMenuTabId)) {
    tabs.append(createUserMenuTab(menu));
  }
}

function findUserMenu() {
  return document.querySelector<HTMLElement>(".user-menu.revamped.menu-panel, .user-menu.menu-panel");
}

function findUserMenuTopTabs(menu: HTMLElement) {
  return menu.querySelector<HTMLElement>(".menu-tabs-container .top-tabs, .menu-tabs-container .tabs-list");
}

function findUserMenuContents(menu: HTMLElement) {
  return menu.querySelector<HTMLElement>(".panel-body-contents");
}

function createUserMenuTab(menu: HTMLElement) {
  const tab = document.createElement("button");
  tab.id = userMenuTabId;
  tab.type = "button";
  tab.className = "btn btn-flat btn-icon no-text user-menu-tab linuxdo-friends-user-menu-tab";
  tab.title = "佬朋友";
  tab.setAttribute("aria-label", "佬朋友");
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-selected", "false");
  tab.innerHTML = discourseFriendIconSvg();
  tab.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openUserMenuPanel(menu);
  });
  return tab;
}

function openUserMenuPanel(menu: HTMLElement) {
  const contents = findUserMenuContents(menu);
  const tab = document.getElementById(userMenuTabId);
  if (!contents || !tab) return;

  markUserMenuLayout(menu);
  hideNativeUserMenuPanels(contents);
  const panel = ensureUserMenuPanel();
  const tabContainer = contents.querySelector<HTMLElement>(".menu-tabs-container");
  if (tabContainer?.parentElement === contents) {
    contents.insertBefore(panel, tabContainer.nextSibling);
  } else {
    contents.prepend(panel);
  }
  menu.querySelectorAll<HTMLElement>(".user-menu-tab.active").forEach((nativeTab) => {
    nativeTab.classList.remove("active");
    nativeTab.setAttribute("aria-selected", "false");
  });
  tab.classList.add("active");
  tab.setAttribute("aria-selected", "true");

  mountUserMenuPanel();
}

function ensureUserMenuPanel() {
  const existing = document.getElementById(userMenuPanelId) as HTMLDivElement | null;
  if (existing) return existing;
  const panel = document.createElement("div");
  panel.id = userMenuPanelId;
  panel.className = "linuxdo-friends-user-menu-panel";
  return panel;
}

function mountUserMenuPanel() {
  const panel = document.getElementById(userMenuPanelId) as HTMLDivElement | null;
  if (!panel || userMenuRoot) return;
  const shadow = panel.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `${appCss}\n${userMenuPanelCss()}`;
  const rootNode = document.createElement("div");
  rootNode.className = "linuxdo-friends-menu-root";
  shadow.append(style, rootNode);
  userMenuRoot = createRoot(rootNode);
  userMenuRoot.render(React.createElement(FriendsApp, { surface: "in-page" }));
}

function closeUserMenuPanel(menu: HTMLElement) {
  restoreNativeUserMenuPanels(menu);
  menu.classList.remove(userMenuActiveClass, userMenuDrawerClass);
  const tab = document.getElementById(userMenuTabId);
  tab?.classList.remove("active");
  tab?.setAttribute("aria-selected", "false");
  unmountUserMenuPanel();
}

function unmountUserMenuPanel() {
  userMenuRoot?.unmount();
  userMenuRoot = null;
  document.getElementById(userMenuPanelId)?.remove();
}

function hideNativeUserMenuPanels(contents: HTMLElement) {
  const tabContainer = contents.querySelector(".menu-tabs-container");
  Array.from(contents.children).forEach((child) => {
    if (!(child instanceof HTMLElement) || child === tabContainer || child.id === userMenuPanelId) return;
    if (!child.hasAttribute(userMenuHiddenAttr)) {
      child.setAttribute(userMenuPreviousDisplayAttr, child.style.display);
      child.setAttribute(userMenuHiddenAttr, "true");
    }
    child.style.display = "none";
  });
}

function restoreNativeUserMenuPanels(menu: HTMLElement) {
  menu.querySelectorAll<HTMLElement>(`[${userMenuHiddenAttr}]`).forEach((element) => {
    element.style.display = element.getAttribute(userMenuPreviousDisplayAttr) ?? "";
    element.removeAttribute(userMenuPreviousDisplayAttr);
    element.removeAttribute(userMenuHiddenAttr);
  });
}

function markUserMenuLayout(menu: HTMLElement) {
  menu.classList.add(userMenuActiveClass);
  menu.classList.toggle(userMenuDrawerClass, isSlideInUserMenu(menu));
}

function isSlideInUserMenu(menu: HTMLElement) {
  if (menu.classList.contains("slide-in")) return true;
  const style = window.getComputedStyle(menu);
  const rect = menu.getBoundingClientRect();
  return style.position === "fixed" && rect.height >= window.innerHeight - 2 && rect.width <= 360;
}

function clearMarkers() {
  document.querySelectorAll(`.${markerClass}`).forEach((marker) => marker.remove());
  document.querySelectorAll(`.${friendAvatarClass}`).forEach((marker) => marker.classList.remove(friendAvatarClass));
  document.querySelectorAll(`.${friendNameMarkClass}`).forEach((marker) => unwrapElement(marker));
}

function isProfileIdentityLink(link: HTMLAnchorElement): boolean {
  try {
    const url = new URL(link.href, location.origin);
    if (url.hostname !== "linux.do" && url.origin !== location.origin) return false;
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.length === 2 && parts[0] === "u" && Boolean(parts[1]);
  } catch {
    return false;
  }
}

function markAvatarElements(link: HTMLAnchorElement) {
  const avatarSelector = [
    "img.avatar",
    "img.user-avatar",
    "img[src*='/user_avatar/']",
    "img[src*='/letter_avatar/']",
    ".avatar img",
    ".user-avatar img"
  ].join(",");
  for (const avatar of link.querySelectorAll<HTMLElement>(avatarSelector)) {
    avatar.classList.add(friendAvatarClass);
  }
}

function markNameText(link: HTMLAnchorElement, displayName: string | null) {
  if (!displayName) return;
  const target = findNameTextNode(link, displayName);
  if (!target?.textContent?.trim()) return;
  const wrapper = document.createElement("span");
  wrapper.className = friendNameMarkClass;
  target.parentNode?.insertBefore(wrapper, target);
  wrapper.append(target);
}

function findNameTextNode(link: HTMLAnchorElement, displayName: string): Text | null {
  const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent?.trim();
      if (!text || !isSameDisplayName(text, displayName)) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest("svg, img, .avatar, .user-avatar, .username, .user-name, .mention")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  return walker.nextNode() as Text | null;
}

function getFriendDisplayName(state: AppState, username: Username): string | null {
  const rawName = state.friendProfiles[username]?.name ?? state.followedUsers[username]?.name;
  const displayName = rawName?.trim();
  if (!displayName) return null;
  if (normalizeIdentityText(displayName) === username) return null;
  return displayName;
}

function isSameDisplayName(text: string, displayName: string) {
  return normalizeDisplayText(text) === normalizeDisplayText(displayName);
}

function normalizeDisplayText(text: string) {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function normalizeIdentityText(text: string) {
  return text.trim().replace(/^@/, "").toLocaleLowerCase();
}

function unwrapElement(element: Element) {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  element.remove();
}

async function openFriendsUserMenu() {
  const existingMenu = findUserMenu();
  if (!existingMenu) {
    const toggle = document.querySelector<HTMLButtonElement>("#toggle-current-user");
    toggle?.click();
  }

  const menu = (await waitForUserMenu()) ?? findUserMenu();
  if (!menu) return;
  enhanceUserMenu();
  openUserMenuPanel(menu);
}

function waitForUserMenu() {
  return new Promise<HTMLElement | null>((resolve) => {
    const existingMenu = findUserMenu();
    if (existingMenu) {
      resolve(existingMenu);
      return;
    }

    let settled = false;
    const observer = new MutationObserver(() => {
      const menu = findUserMenu();
      if (menu) finish(menu);
    });
    const timer = window.setTimeout(() => finish(null), 800);

    function finish(menu: HTMLElement | null) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      observer.disconnect();
      resolve(menu);
    }

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function placeLauncher(launcher: HTMLButtonElement): boolean {
  const currentUserItem = findCurrentUserHeaderItem();
  if (currentUserItem?.parentElement) {
    if (currentUserItem.tagName.toLowerCase() === "li") {
      const wrapper = ensureLauncherHeaderItem(launcher);
      if (wrapper.parentElement !== currentUserItem.parentElement || wrapper.nextElementSibling !== currentUserItem) {
        currentUserItem.parentElement.insertBefore(wrapper, currentUserItem);
      }
      dockLauncherToHeader(launcher);
      return true;
    }
    moveLauncherDirectlyBefore(launcher, currentUserItem);
    dockLauncherToHeader(launcher);
    return true;
  }

  const anchor = findLauncherAnchor();
  if (anchor?.parentElement) {
    moveLauncherDirectlyBefore(launcher, anchor);
    dockLauncherToHeader(launcher);
    return true;
  }
  return false;
}

function ensureLauncherHeaderItem(launcher: HTMLButtonElement) {
  const existingWrapper = launcher.closest<HTMLElement>(".linuxdo-friends-header-item");
  if (existingWrapper) return existingWrapper;
  const wrapper = document.createElement("li");
  wrapper.className = "header-dropdown-toggle linuxdo-friends-header-item";
  wrapper.append(launcher);
  return wrapper;
}

function moveLauncherDirectlyBefore(launcher: HTMLButtonElement, anchor: HTMLElement) {
  const parent = anchor.parentElement;
  if (!parent) return;
  const wrapper = launcher.closest<HTMLElement>(".linuxdo-friends-header-item");
  if (wrapper) {
    parent.insertBefore(launcher, anchor);
    if (!wrapper.contains(launcher)) wrapper.remove();
    removeEmptyLauncherWrappers();
    return;
  }
  if (launcher.parentElement !== parent || launcher.nextElementSibling !== anchor) {
    parent.insertBefore(launcher, anchor);
  }
}

function removeEmptyLauncherWrappers() {
  document.querySelectorAll<HTMLElement>(".linuxdo-friends-header-item").forEach((wrapper) => {
    if (!wrapper.querySelector(`#${launcherId}`)) wrapper.remove();
  });
}

function dockLauncherToHeader(launcher: HTMLButtonElement) {
  launcher.style.cssText = launcherStyle();
}

function dockLauncherToFallback(launcher: HTMLButtonElement) {
  const wrapper = launcher.closest<HTMLElement>(".linuxdo-friends-header-item");
  if (wrapper) {
    document.body.append(launcher);
    wrapper.remove();
  } else if (launcher.parentElement !== document.body) {
    document.body.append(launcher);
  }
  launcher.style.cssText = fallbackLauncherStyle();
}

function findCurrentUserHeaderItem(): HTMLElement | null {
  const currentUser = document.querySelector<HTMLElement>(".d-header-icons .current-user, header .current-user");
  if (!currentUser) return null;
  return (
    currentUser.closest<HTMLElement>(".header-dropdown-toggle") ??
    currentUser.closest<HTMLElement>("li") ??
    currentUser
  );
}

function findLauncherAnchor(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(".d-header-icons .current-user, header .current-user") ??
    document.querySelector<HTMLElement>(".d-header-icons") ??
    null
  );
}

function launcherStyle() {
  return [
    "margin:0",
    "vertical-align:middle",
    "position:relative"
  ].join(";");
}

function fallbackLauncherStyle() {
  return [
    launcherStyle(),
    "position:fixed",
    "top:12px",
    "right:72px",
    "z-index:999999"
  ].join(";");
}

function createLauncherStatusDot() {
  const dot = document.createElement("span");
  dot.className = "linuxdo-friends-launcher-status-dot";
  dot.setAttribute("aria-hidden", "true");
  dot.textContent = "×";
  dot.style.cssText = [
    "position:absolute",
    "right:5px",
    "bottom:4px",
    "display:none",
    "width:11px",
    "height:11px",
    "place-items:center",
    "color:#ef4444",
    "font-size:12px",
    "font-weight:800",
    "line-height:1",
    "text-shadow:0 1px 1px rgb(0 0 0 / 0.35)",
    "pointer-events:none"
  ].join(";");
  return dot;
}

function updateLauncherStatusDot(status: "pending" | "connected" | "disconnected") {
  lastHeartbeatStatus = status;
  const dot = document.querySelector<HTMLElement>("#linuxdo-friends-launcher .linuxdo-friends-launcher-status-dot");
  if (!dot) return;
  dot.style.display = status === "disconnected" ? "grid" : "none";
}

function startHeartbeat() {
  sendHeartbeat();
  if (heartbeatTimer != null) return;
  heartbeatTimer = window.setInterval(sendHeartbeat, heartbeatIntervalMs);
}

function sendHeartbeat() {
  try {
    const message = {
      type: "linuxdoFriends.pageHeartbeat",
      url: location.href,
      title: document.title,
      status: pageHeartbeatStatus(),
      hasLauncher: Boolean(document.getElementById(launcherId))
    };
    void chrome.runtime.sendMessage(message).then(
      () => updateLauncherStatusDot("connected"),
      () => updateLauncherStatusDot("disconnected")
    );
  } catch {
    updateLauncherStatusDot("disconnected");
  }
}

function pageHeartbeatStatus() {
  const bodyText = document.body?.textContent?.slice(0, 4000) ?? "";
  return looksLikeChallenge(bodyText) ? "challenge" : "ready";
}

function discourseFriendIconSvg() {
  return [
    '<svg class="fa d-icon d-icon-user-group svg-icon fa-width-auto svg-string" width="1em" height="1em" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">',
    '<use href="#user-group"></use>',
    "</svg>"
  ].join("");
}

function userMenuPanelCss() {
  return `
    :host {
      color-scheme: dark;
      all: initial;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .linuxdo-friends-menu-root {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      background: #101414;
    }
    .linuxdo-friends-menu-root .shell {
      width: 100%;
      min-height: 100%;
      height: auto;
      padding: 10px;
    }
    .linuxdo-friends-menu-root .sticky-top {
      margin: -10px -10px 8px;
      padding: 10px 10px 1px;
    }
    .linuxdo-friends-menu-root .header {
      gap: 10px;
      margin-bottom: 10px;
    }
    .linuxdo-friends-menu-root .header h1 {
      font-size: 20px;
    }
    .linuxdo-friends-menu-root .tab-action-row {
      margin-top: 6px;
    }
    .linuxdo-friends-menu-root .modal-backdrop {
      position: absolute;
      inset: 0;
      align-items: stretch;
      justify-content: stretch;
      padding: 8px;
      background: rgb(15 23 42 / 0.26);
    }
    .linuxdo-friends-menu-root .modal {
      width: 100%;
      height: 100%;
      max-height: none;
      min-width: 0;
      padding: 10px;
      box-shadow: none;
    }
    .linuxdo-friends-menu-root .modal-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: start;
      gap: 8px;
    }
    .linuxdo-friends-menu-root .modal-head > div {
      grid-column: 1;
      grid-row: 1;
    }
    .linuxdo-friends-menu-root .modal-head .icon-button {
      grid-column: 2;
      grid-row: 1;
      justify-self: end;
    }
    .linuxdo-friends-menu-root .modal-head .small-action {
      grid-row: 2;
      grid-column: 1 / -1;
      justify-content: center;
      width: 100%;
      max-width: 100%;
    }
    .linuxdo-friends-menu-root .modal-list {
      margin-right: 0;
      padding-right: 4px;
    }
  `;
}

function subscribeToStorageChanges() {
  try {
    chrome.storage?.onChanged?.addListener((_changes, areaName) => {
      if (areaName === "local") {
        void init();
      }
    });
  } catch {
    // Content script must stay non-breaking if extension APIs are unavailable in tests or restricted pages.
  }
}

function subscribeToRuntimeMessages() {
  try {
    chrome.runtime?.onMessage?.addListener((message: unknown, _sender, sendResponse) => {
      if (!isContentScriptCommand(message)) return false;
      const response = runContentScriptCommand(message);
      void response.then(sendResponse);
      return true;
    });
  } catch {
    // Content script must keep page enhancement working even if runtime messaging is unavailable.
  }
}

function runContentScriptCommand(message: ContentScriptCommand): Promise<ContentScriptResponse> {
  if (message.type === "linuxdoFriends.extractCurrentAccount") return extractCurrentAccountFromPage();
  if (message.type === "linuxdoFriends.extractFollowing") return extractFollowingFromPage();
  if (message.type === "linuxdoFriends.extractProfile") return extractProfileFromPage(message.username);
  if (message.type === "linuxdoFriends.extractAvatar") return extractAvatarFromPage(message.username, message.avatarUrl);
  return extractActivityFromPage(message.username, message.kind ?? "all");
}

async function extractCurrentAccountFromPage(): Promise<ContentScriptCurrentAccountResponse> {
  const login = await fetchJson("/latest.json");
  if (!login.ok) {
    return { ok: false, reason: login.reason, error: login.error };
  }
  const username = login.response.headers.get("x-discourse-username")?.trim().replace(/^@/, "").toLowerCase();
  if (!username) {
    return { ok: false, reason: "unavailable", error: "当前 linux.do 页面没有识别到登录账号。" };
  }
  return { ok: true, username };
}

async function extractFollowingFromPage(): Promise<ContentScriptFollowingResponse> {
  const account = await extractCurrentAccountFromPage();
  if (!account.ok) {
    return account;
  }
  const { username } = account;
  const following = await fetchJson(`/u/${encodeURIComponent(username)}/follow/following.json`);
  if (!following.ok) {
    return { ok: false, reason: following.reason, error: following.error };
  }
  return { ok: true, username, users: extractFollowedUsers(following.json) };
}

async function extractProfileFromPage(username: Username): Promise<ContentScriptProfileResponse> {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    return { ok: false, reason: "unavailable", error: "缺少要添加的用户名。" };
  }
  const profile = await fetchJson(`/u/${encodeURIComponent(normalizedUsername)}.json`);
  if (!profile.ok) {
    return { ok: false, reason: profile.reason, error: profile.error };
  }
  try {
    return { ok: true, profile: extractFriendProfile(profile.json) };
  } catch {
    return { ok: false, reason: "invalid_response", error: "linux.do 返回的用户资料格式不完整。" };
  }
}

async function extractActivityFromPage(
  username: Username,
  kind: ActivityKindFilter | ActivityRefreshRequestKind = "all"
): Promise<ContentScriptActivityResponse> {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    return { ok: false, reason: "unavailable", error: "缺少要刷新的好友用户名。" };
  }
  const items: ActivityItem[] = [];
  for (const step of activityRequestStepsForUser(normalizedUsername, kind)) {
    const response = await fetchJson(step.path);
    if (!response.ok) return { ok: false, reason: response.reason, error: response.error };
    items.push(...normalizeStepItems(normalizedUsername, step.kind, response.json));
  }
  return { ok: true, activity: summaryFromItems(normalizedUsername, items) };
}

async function extractAvatarFromPage(
  username: Username,
  avatarUrl: string
): Promise<ContentScriptAvatarResponse> {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername || !isLinuxDoAvatarUrl(avatarUrl)) {
    return { ok: false, reason: "unavailable", error: "头像地址不在允许范围内。" };
  }
  try {
    const url = new URL(avatarUrl);
    const response = await fetch(`${url.pathname}${url.search}`, {
      credentials: "same-origin",
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8" }
    });
    if (!response.ok) {
      return { ok: false, reason: response.status === 429 ? "rate_limited" : "network_error", error: `头像加载失败：${response.status}` };
    }
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "image/png";
    if (!["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"].includes(contentType)) {
      return { ok: false, reason: "invalid_response", error: "头像响应不是图片。" };
    }
    const blob = await response.blob();
    if (blob.size > 96_000) {
      return { ok: false, reason: "invalid_response", error: "头像图片过大，未缓存。" };
    }
    return {
      ok: true,
      username: normalizedUsername,
      sourceUrl: avatarUrl,
      dataUrl: await blobToDataUrl(blob),
      contentType,
      byteLength: blob.size
    };
  } catch {
    return { ok: false, reason: "network_error", error: "页面内头像加载失败。" };
  }
}

async function fetchJson(path: string): Promise<
  | { ok: true; response: Response; json: unknown }
  | { ok: false; reason: RefreshFailureReason | "unavailable"; error: string }
> {
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    const text = await response.text();
    if (looksLikeChallenge(text)) {
      return { ok: false, reason: "challenge", error: "linux.do 要求浏览器验证，请在页面完成验证后再同步。" };
    }
    if (response.status === 403) {
      return { ok: false, reason: "blocked", error: "linux.do 拒绝了本次页面内同步。" };
    }
    if (response.status === 429) {
      return { ok: false, reason: "rate_limited", error: "linux.do 返回限流，已停止同步。" };
    }
    if (!response.ok) {
      return { ok: false, reason: "network_error", error: `页面内请求失败：${response.status}` };
    }
    try {
      return { ok: true, response, json: JSON.parse(text) };
    } catch {
      return { ok: false, reason: "invalid_response", error: "linux.do 返回的内容不是可解析 JSON。" };
    }
  } catch {
    return { ok: false, reason: "network_error", error: "页面内请求失败，请确认 linux.do 标签页仍然可用。" };
  }
}

function isContentScriptCommand(value: unknown): value is ContentScriptCommand {
  if (typeof value !== "object" || value == null) return false;
  const message = value as { type?: unknown; username?: unknown; kind?: unknown; avatarUrl?: unknown };
  if (message.type === "linuxdoFriends.extractCurrentAccount") return true;
  if (message.type === "linuxdoFriends.extractFollowing") return true;
  if (message.type === "linuxdoFriends.extractAvatar") {
    return typeof message.username === "string" && message.username.trim().length > 0 && typeof message.avatarUrl === "string";
  }
  return (
    (message.type === "linuxdoFriends.extractActivity" || message.type === "linuxdoFriends.extractProfile") &&
    typeof message.username === "string" &&
    message.username.trim().length > 0 &&
    (message.type !== "linuxdoFriends.extractActivity" || message.kind === undefined || isActivityKind(message.kind))
  );
}

function isLinuxDoAvatarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "linux.do" && (url.pathname.startsWith("/user_avatar/") || url.pathname.startsWith("/letter_avatar/"));
  } catch {
    return false;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Avatar conversion failed"));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Avatar conversion failed")));
    reader.readAsDataURL(blob);
  });
}

function isActivityKind(value: unknown): value is ActivityKindFilter | ActivityRefreshRequestKind {
  return value === "all" || value === "topic" || value === "reply" || value === "boost" || value === "reaction" || value === "user_actions";
}

function extractUsername(link: HTMLAnchorElement) {
  const match = link.href.match(/\/u\/([^/?#]+)/);
  return match?.[1]?.toLowerCase();
}

function looksLikeChallenge(text: string): boolean {
  const lowered = text.slice(0, 4000).toLowerCase();
  return (
    lowered.includes("cf-mitigated") ||
    lowered.includes("just a moment") ||
    lowered.includes("challenge-error-text") ||
    lowered.includes("enable javascript and cookies")
  );
}

function extractFollowedUsers(json: unknown): FollowedUserInput[] {
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

// Mirrored from src/api/profileParser.ts intentionally for the same self-contained MV3 content-script build boundary.
function extractFriendProfile(json: unknown): FriendProfileSummary {
  if (!isRecord(json) || !isRecord(json.user)) {
    throw new Error("Invalid linux.do profile response");
  }
  const username = readString(json.user, "username");
  if (!username) {
    throw new Error("Invalid linux.do profile response");
  }
  const avatarTemplate = readString(json.user, "avatar_template");
  const avatarUrl = avatarUrlFromTemplate(avatarTemplate) ?? avatarUrlFromTemplate(readString(json.user, "avatar_url"));
  return {
    username: normalizeUsername(username),
    name: readString(json.user, "name"),
    avatarUrl,
    lastPostedAt: readString(json.user, "last_posted_at"),
    lastSeenAt: readString(json.user, "last_seen_at"),
    refreshedAt: new Date().toISOString()
  };
}

interface RawUserAction {
  id?: number | string;
  action_type?: number;
  title?: string;
  topic_title?: string;
  excerpt?: string;
  created_at?: string;
  post_url?: string;
  slug?: string;
  topic_id?: number;
  target_name?: string | null;
  target_username?: string | null;
  post_number?: number;
  post_id?: number | null;
  reply_to_post_number?: number | null;
  username?: string;
  name?: string | null;
  acting_username?: string;
  acting_name?: string | null;
  avatar_template?: string;
  acting_avatar_template?: string;
  category_id?: number | null;
  deleted?: boolean;
  hidden?: boolean | null;
  closed?: boolean;
  archived?: boolean;
  truncated?: boolean;
}

interface RawBoost {
  id?: number | string;
  raw?: string;
  cooked?: string;
  created_at?: string;
  post_id?: number;
  user?: Record<string, unknown>;
  post?: Record<string, unknown>;
}

interface RawReaction {
  id?: number | string;
  post_id?: number;
  created_at?: string;
  user?: Record<string, unknown>;
  post?: Record<string, unknown>;
  reaction?: Record<string, unknown>;
}

interface RawFriendActivitySources {
  userActions: RawUserAction[];
  boosts: RawBoost[];
  reactions: RawReaction[];
}

interface ActivityRequestStep {
  username: Username;
  kind: ActivityRefreshRequestKind;
  path: string;
}

// Mirrored from src/domain/activity.ts intentionally: the MV3 content script must build as a self-contained non-module file.
// Keep src/content/contentScript.test.ts parity coverage in sync when endpoint normalization changes.
function extractUserActions(json: unknown): RawUserAction[] {
  if (!isRecord(json)) return [];
  const value = json.user_actions;
  return Array.isArray(value) ? value.filter(isRawUserAction) : [];
}

function isRawUserAction(value: unknown): value is RawUserAction {
  return isRecord(value);
}

function extractBoosts(json: unknown): RawBoost[] {
  if (!isRecord(json)) return [];
  const value = json.boosts;
  return Array.isArray(value) ? value.filter(isRawBoost) : [];
}

function isRawBoost(value: unknown): value is RawBoost {
  return isRecord(value);
}

function extractReactions(json: unknown): RawReaction[] {
  return Array.isArray(json) ? json.filter(isRawReaction) : [];
}

function isRawReaction(value: unknown): value is RawReaction {
  return isRecord(value);
}

function normalizeFriendActivity(usernameInput: Username, sources: RawFriendActivitySources): FriendActivitySummary {
  const username = normalizeUsername(usernameInput);
  const items = sortActivityItems([
    ...sources.userActions.map((action) => normalizeUserAction(username, action)),
    ...sources.boosts.map(normalizeBoost),
    ...sources.reactions.map(normalizeReaction)
  ]);
  const lastPostAt = items.find((item) => item.occurredAt)?.occurredAt;
  return {
    username,
    refreshedAt: new Date().toISOString(),
    coarseStatus: classifyCoarseStatus(lastPostAt),
    lastPostAt,
    items
  };
}

function summaryFromItems(usernameInput: Username, itemsInput: ActivityItem[]): FriendActivitySummary {
  const username = normalizeUsername(usernameInput);
  const items = sortActivityItems(itemsInput);
  const lastPostAt = items.find((item) => item.occurredAt)?.occurredAt;
  return {
    username,
    refreshedAt: new Date().toISOString(),
    coarseStatus: classifyCoarseStatus(lastPostAt),
    lastPostAt,
    items
  };
}

function activityRequestStepsForUser(username: Username, kind: ActivityKindFilter | ActivityRefreshRequestKind): ActivityRequestStep[] {
  if (kind === "topic") {
    return [{ username, kind: "topic", path: `/user_actions.json?offset=0&username=${encodeURIComponent(username)}&filter=4` }];
  }
  if (kind === "reply") {
    return [{ username, kind: "reply", path: `/user_actions.json?offset=0&username=${encodeURIComponent(username)}&filter=5` }];
  }
  if (kind === "boost") {
    return [{ username, kind: "boost", path: `/discourse-boosts/users/${encodeURIComponent(username)}/boosts-given.json` }];
  }
  if (kind === "reaction") {
    return [{ username, kind: "reaction", path: `/discourse-reactions/posts/reactions.json?username=${encodeURIComponent(username)}` }];
  }
  if (kind === "user_actions") {
    return [{ username, kind: "user_actions", path: `/user_actions.json?offset=0&username=${encodeURIComponent(username)}&filter=4,5` }];
  }
  return [
    { username, kind: "user_actions", path: `/user_actions.json?offset=0&username=${encodeURIComponent(username)}&filter=4,5` },
    { username, kind: "boost", path: `/discourse-boosts/users/${encodeURIComponent(username)}/boosts-given.json` },
    { username, kind: "reaction", path: `/discourse-reactions/posts/reactions.json?username=${encodeURIComponent(username)}` }
  ];
}

function normalizeStepItems(username: Username, kind: ActivityRefreshRequestKind, json: unknown): ActivityItem[] {
  if (kind === "topic" || kind === "reply") {
    return extractUserActions(json)
      .map((action) => normalizeUserAction(username, action))
      .filter((item) => item.kind === kind);
  }
  if (kind === "user_actions") {
    return extractUserActions(json).map((action) => normalizeUserAction(username, action));
  }
  if (kind === "boost") return extractBoosts(json).map(normalizeBoost);
  return extractReactions(json).map(normalizeReaction);
}

function normalizeUserAction(usernameInput: Username, action: RawUserAction): ActivityItem {
  const requestedUsername = normalizeUsername(usernameInput);
  const actorUsername = normalizeOptionalUsername(action.acting_username ?? action.username) ?? requestedUsername;
  const kind = action.action_type === 4 ? "topic" : "reply";
  const topicId = readNumber(action.topic_id);
  const postId = readNumber(action.post_id);
  const postNumber = readNumber(action.post_number);
  const occurredAt = readStringValue(action.created_at);
  const title = readStringValue(action.title) ?? readStringValue(action.topic_title) ?? "未命名动态";
  return {
    id: `user_action:${requestedUsername}:${action.action_type ?? "unknown"}:${topicId ?? "no-topic"}:${
      postId ?? postNumber ?? occurredAt ?? "unknown"
    }`,
    username: actorUsername,
    kind,
    title,
    url: readStringValue(action.post_url) ?? topicUrl(action.slug, topicId, postNumber),
    occurredAt,
    excerpt: plainTextFromHtmlish(action.excerpt),
    source: "user_actions",
    actorUsername,
    actorName: readStringValue(action.acting_name) ?? readStringValue(action.name),
    actorAvatarUrl: avatarUrlFromTemplate(action.acting_avatar_template ?? action.avatar_template),
    targetUsername: normalizeOptionalUsername(action.target_username),
    targetName: readStringValue(action.target_name),
    topicId,
    topicTitle: title,
    postId,
    postNumber,
    replyToPostNumber: readNumber(action.reply_to_post_number),
    categoryId: readNumber(action.category_id),
    truncated: action.truncated === true,
    deleted: action.deleted === true,
    hidden: action.hidden === true,
    closed: action.closed === true,
    archived: action.archived === true
  };
}

function normalizeBoost(boost: RawBoost): ActivityItem {
  const actor = isRecord(boost.user) ? boost.user : {};
  const post = isRecord(boost.post) ? boost.post : {};
  const actorUsername = normalizeOptionalUsername(readString(actor, "username")) ?? "unknown";
  const topicTitle = readString(post, "topic_title") ?? readString(post, "title") ?? "未命名主题";
  return {
    id: `boost:${boost.id ?? `${actorUsername}:${boost.post_id ?? boost.created_at ?? "unknown"}`}`,
    username: actorUsername,
    kind: "boost",
    title: topicTitle,
    url: readString(post, "url"),
    occurredAt: readStringValue(boost.created_at),
    excerpt: plainTextFromHtmlish(readString(post, "excerpt")),
    source: "boosts",
    actorUsername,
    actorName: readString(actor, "name"),
    actorAvatarUrl: avatarUrlFromTemplate(readString(actor, "avatar_template")),
    targetUsername: normalizeOptionalUsername(readString(post, "username")),
    targetName: readString(post, "name"),
    targetAvatarUrl: avatarUrlFromTemplate(readString(post, "avatar_template")),
    topicId: readNumber(post.topic_id),
    topicTitle,
    postId: readNumber(post.id) ?? readNumber(boost.post_id),
    categoryId: readNumber(post.category_id),
    boostText: plainTextFromHtmlish(boost.raw) ?? plainTextFromHtmlish(boost.cooked)
  };
}

function normalizeReaction(reaction: RawReaction): ActivityItem {
  const actor = isRecord(reaction.user) ? reaction.user : {};
  const post = isRecord(reaction.post) ? reaction.post : {};
  const reactionRecord = isRecord(reaction.reaction) ? reaction.reaction : {};
  const actorUsername = normalizeOptionalUsername(readString(actor, "username")) ?? "unknown";
  const topicTitle = readString(post, "topic_title") ?? readNestedTopicTitle(post) ?? "未命名主题";
  return {
    id: `reaction:${reaction.id ?? `${actorUsername}:${reaction.post_id ?? reaction.created_at ?? "unknown"}`}`,
    username: actorUsername,
    kind: "reaction",
    title: topicTitle,
    url: readString(post, "url"),
    occurredAt: readStringValue(reaction.created_at) ?? readString(reactionRecord, "created_at"),
    excerpt: plainTextFromHtmlish(readString(post, "excerpt")),
    source: "reactions",
    actorUsername,
    actorName: readString(actor, "name"),
    actorAvatarUrl: avatarUrlFromTemplate(readString(actor, "avatar_template")),
    targetUsername: normalizeOptionalUsername(readString(post, "username")),
    targetName: readString(post, "name"),
    targetAvatarUrl: avatarUrlFromTemplate(readString(post, "avatar_template")),
    topicId: readNumber(post.topic_id),
    topicTitle,
    postId: readNumber(post.id) ?? readNumber(reaction.post_id),
    postNumber: readNumber(post.post_number),
    categoryId: readNumber(post.category_id),
    reactionValue: readString(reactionRecord, "reaction_value")
  };
}

function sortActivityItems(items: ActivityItem[]): ActivityItem[] {
  return [...items].sort((a, b) => {
    const byTime = timestampValue(b.occurredAt) - timestampValue(a.occurredAt);
    if (byTime !== 0) return byTime;
    return a.id.localeCompare(b.id);
  });
}

function classifyCoarseStatus(value?: string): FriendActivitySummary["coarseStatus"] {
  if (!value) return "unknown";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "unknown";
  const age = Date.now() - timestamp;
  if (age < 3 * 24 * 60 * 60 * 1000) return "recently_active";
  if (age < 7 * 24 * 60 * 60 * 1000) return "active_this_week";
  return "quiet";
}

function plainTextFromHtmlish(value?: string): string | undefined {
  if (!value) return undefined;
  const text = decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
  )
    .replace(/\s+([,.;:!?，。；：！？…])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

function avatarUrlFromTemplate(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace("{size}", "48");
  if (normalized.startsWith("//")) return `https:${normalized}`;
  if (normalized.startsWith("/")) return `https://linux.do${normalized}`;
  return normalized;
}

function topicUrl(slug: unknown, topicId?: number, postNumber?: number): string | undefined {
  if (!topicId) return undefined;
  const safeSlug = typeof slug === "string" && slug.trim() ? slug.trim() : "topic";
  return `/t/${safeSlug}/${topicId}${postNumber ? `/${postNumber}` : ""}`;
}

function readNestedTopicTitle(post: Record<string, unknown>): string | undefined {
  const topic = post.topic;
  if (!isRecord(topic)) return undefined;
  return readString(topic, "title") ?? readString(topic, "fancy_title");
}

function timestampValue(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeOptionalUsername(value?: string | null): Username | undefined {
  if (!value) return undefined;
  const username = normalizeUsername(value);
  return username || undefined;
}

function readStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
    hellip: "..."
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[key] ?? match;
  });
}

function normalizeUsername(username: Username): Username {
  return username.trim().replace(/^@/, "").toLowerCase();
}
