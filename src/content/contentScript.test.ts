import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractBoosts, extractReactions, extractUserActions, normalizeFriendActivity } from "../domain/activity";
import { extractFriendProfile } from "../api/profileParser";
import { defaultAppState } from "../domain/defaultState";
import { addFriendFromProfile } from "../domain/friends";

describe("content script friend markers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("marks only known friends and remains idempotent", async () => {
    const state = addFriendFromProfile(defaultAppState, {
      username: "Neil",
      name: "Neo",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });
    document.body.innerHTML = `
      <a href="/u/neil"><img class="avatar" src="/user_avatar/linux.do/neil/48/1.png" alt="">Neo</a>
      <a href="/u/neil" class="username">@neil</a>
      <a href="/u/neil/summary" class="user-navigation-tab">总结</a>
      <a href="/u/neil"><img class="avatar" src="/user_avatar/linux.do/neil/48/1.png" alt="">neil</a>
      <a href="/u/other">Other</a>
    `;

    const { markFriends } = await import("./contentScript");
    markFriends(state);
    markFriends(state);

    const friendLink = document.querySelector<HTMLAnchorElement>('a[href="/u/neil"]');
    expect(document.querySelectorAll(".linuxdo-friends-marker")).toHaveLength(0);
    expect(friendLink?.classList.contains("linuxdo-friends-friend-link")).toBe(false);
    expect(friendLink?.querySelector("img")?.classList.contains("linuxdo-friends-friend-avatar")).toBe(true);
    expect(friendLink?.querySelector(".linuxdo-friends-name-mark")?.textContent).toBe("Neo");
    expect(friendLink?.textContent).toBe("Neo");
    expect(document.querySelector('a.username')?.querySelector(".linuxdo-friends-name-mark")).toBeNull();
    expect(document.querySelector('a[href="/u/neil/summary"]')?.querySelector(".linuxdo-friends-name-mark")).toBeNull();
    const plainUsernameLink = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href="/u/neil"]')).find(
      (link) => link.textContent?.trim() === "neil"
    );
    expect(plainUsernameLink?.querySelector(".linuxdo-friends-name-mark")).toBeNull();
    expect(document.querySelector('a[href="/u/other"]')?.textContent).toBe("Other");
    const pageStyle = document.getElementById("linuxdo-friends-page-style")?.textContent ?? "";
    expect(pageStyle).toContain("linuxdo-friends-friend-avatar");
    expect(pageStyle).toContain("linuxdo-friends-name-mark");
    expect(pageStyle).not.toContain("outline:");
    expect(pageStyle).toContain("0 0 52px color-mix(in srgb, var(--linuxdo-friends-accent) 20%, transparent)");
    expect(pageStyle).toContain("0 0 68px color-mix(in srgb, var(--linuxdo-friends-accent) 28%, transparent)");
    expect(pageStyle).toContain("animation: linuxdo-friends-avatar-breathe");
    expect(pageStyle).toContain("@media (prefers-reduced-motion: reduce)");
    expect(pageStyle).toContain("height: 34%");
    expect(pageStyle).toContain("padding-inline: 1ch");
    expect(pageStyle).toContain("top: 56%");
    expect(pageStyle).not.toMatch(/\n\s*color:\s/);
  });

  it("removes stale markers when the friend set changes", async () => {
    const state = addFriendFromProfile(defaultAppState, {
      username: "Neil",
      name: "Neo",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });
    document.body.innerHTML = '<a href="/u/neil"><img class="avatar" src="/avatar.png" alt="">Neo</a>';

    const { markFriends } = await import("./contentScript");
    markFriends(state);
    markFriends(defaultAppState);

    expect(document.querySelectorAll(".linuxdo-friends-marker")).toHaveLength(0);
    expect(document.querySelector('a[href="/u/neil"]')?.textContent).toBe("Neo");
    expect(document.querySelector('a[href="/u/neil"]')?.querySelector(".linuxdo-friends-name-mark")).toBeNull();
    expect(document.querySelector("img")?.classList.contains("linuxdo-friends-friend-avatar")).toBe(false);
  });

  it("reapplies friend markers after Discourse-style in-page navigation", async () => {
    vi.useFakeTimers();
    const state = addFriendFromProfile(defaultAppState, {
      username: "Neil",
      name: "Neo",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });
    document.body.innerHTML = `
      <main id="main-outlet">
        <a href="/u/other">Other</a>
      </main>
    `;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: state })),
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    await import("./contentScript");
    await Promise.resolve();
    document.getElementById("main-outlet")?.insertAdjacentHTML(
      "beforeend",
      '<a href="/u/neil"><img class="avatar" src="/user_avatar/linux.do/neil/48/1.png" alt="">Neo</a>'
    );
    window.history.pushState({}, "", "/u/neil");
    await vi.runOnlyPendingTimersAsync();

    const friendLink = document.querySelector<HTMLAnchorElement>('a[href="/u/neil"]');
    expect(friendLink?.querySelector(".linuxdo-friends-name-mark")?.textContent).toBe("Neo");
    expect(friendLink?.querySelector("img")?.classList.contains("linuxdo-friends-friend-avatar")).toBe(true);
    vi.useRealTimers();
  });

  it("injects a page launcher before the current-user header item and opens the native user menu friends tab", async () => {
    document.body.innerHTML = `
      <ul class="d-header-icons">
        <li class="header-dropdown-toggle locale-toggle"><button>ZH</button></li>
        <li class="header-dropdown-toggle current-user">
          <button id="toggle-current-user" class="current-user">me</button>
        </li>
      </ul>
    `;
    document.getElementById("toggle-current-user")?.addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `
          <div class="user-menu revamped menu-panel">
            <div class="panel-body">
              <div class="panel-body-contents">
                <div class="quick-access-panel">native notifications</div>
                <div class="menu-tabs-container" role="tablist">
                  <div class="top-tabs tabs-list">
                    <a id="user-menu-button-all-notifications" class="btn btn-flat btn-icon no-text user-menu-tab active" role="tab" aria-selected="true">native</a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `
      );
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    const { ensureLauncher } = await import("./contentScript");
    ensureLauncher();
    const launcher = document.getElementById("linuxdo-friends-launcher") as HTMLButtonElement | null;

    expect(launcher).toBeTruthy();
    expect(launcher?.className).toContain("btn");
    expect(launcher?.className).toContain("btn-flat");
    expect(launcher?.querySelector("svg")?.className.baseVal).toContain("d-icon-user-group");
    expect(launcher?.querySelector("use")?.getAttribute("href")).toBe("#user-group");
    const headerItems = Array.from(document.querySelectorAll(".d-header-icons > li"));
    expect(headerItems.map((item) => item.className)).toEqual([
      "header-dropdown-toggle locale-toggle",
      "header-dropdown-toggle linuxdo-friends-header-item",
      "header-dropdown-toggle current-user"
    ]);
    expect(headerItems[1].querySelector("#linuxdo-friends-launcher")).toBe(launcher);

    launcher?.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const userMenuPanel = document.getElementById("linuxdo-friends-user-menu-panel");
    expect(userMenuPanel?.shadowRoot?.querySelector(".linuxdo-friends-menu-root")).toBeTruthy();
    expect(document.getElementById("linuxdo-friends-user-menu-tab")?.className).toContain("active");
    expect(document.querySelector("[id^='linuxdo-friends-panel-host'], .linuxdo-friends-inpage-root")).toBeNull();
  });

  it("falls back to direct insertion before a simple current-user button", async () => {
    document.body.innerHTML = '<div class="d-header-icons"><button class="current-user">me</button></div>';
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    const { ensureLauncher } = await import("./contentScript");
    ensureLauncher();

    const launcher = document.getElementById("linuxdo-friends-launcher") as HTMLButtonElement | null;
    expect(launcher).toBeTruthy();
    expect(document.querySelector(".d-header-icons")?.firstElementChild).toBe(launcher);
  });

  it("repositions the launcher when Discourse rebuilds the header after an early insertion", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div class="loading-header"></div>';
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    const { ensureLauncher } = await import("./contentScript");
    ensureLauncher();
    const launcher = document.getElementById("linuxdo-friends-launcher") as HTMLButtonElement | null;
    expect(launcher).toBeTruthy();
    expect(launcher?.parentElement).toBe(document.body);
    expect(launcher?.style.position).toBe("fixed");

    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <ul class="d-header-icons">
          <li class="header-dropdown-toggle locale-toggle"><button>ZH</button></li>
          <li class="header-dropdown-toggle current-user">
            <button id="toggle-current-user" class="current-user">me</button>
          </li>
        </ul>
      `
    );

    await vi.runOnlyPendingTimersAsync();
    const headerItems = Array.from(document.querySelectorAll(".d-header-icons > li"));
    expect(headerItems.map((item) => item.className)).toEqual([
      "header-dropdown-toggle locale-toggle",
      "header-dropdown-toggle linuxdo-friends-header-item",
      "header-dropdown-toggle current-user"
    ]);
    expect(headerItems[1].querySelector("#linuxdo-friends-launcher")).toBe(launcher);
    expect(launcher?.style.position).toBe("relative");
    expect(document.body.querySelector(":scope > #linuxdo-friends-launcher")).toBeNull();

    vi.useRealTimers();
  });

  it("sends page heartbeats and leaves the launcher indicator hidden when the extension responds", async () => {
    document.body.innerHTML = '<div class="d-header-icons"><button class="current-user">me</button></div>';
    const sendMessage = vi.fn(async (message: unknown) =>
      isHeartbeatMessage(message)
        ? { status: "connected", connectedCount: 1, staleCount: 0, heartbeats: [], updatedAt: new Date().toISOString() }
        : isGetPageScriptStatusMessage(message)
          ? { ok: true, data: { status: "connected", connectedCount: 1, staleCount: 0, heartbeats: [], updatedAt: new Date().toISOString() } }
          : { ok: true, data: defaultAppState }
    );
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    const { ensureLauncher } = await import("./contentScript");
    ensureLauncher();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "linuxdoFriends.pageHeartbeat",
        status: "ready",
        hasLauncher: expect.any(Boolean)
      })
    );
    const dot = document.querySelector<HTMLElement>("#linuxdo-friends-launcher .linuxdo-friends-launcher-status-dot");
    expect(dot?.textContent).toBe("×");
    expect(dot?.style.display).toBe("none");
  });

  it("shows a red x on the launcher only when page heartbeat delivery fails", async () => {
    document.body.innerHTML = '<div class="d-header-icons"><button class="current-user">me</button></div>';
    const sendMessage = vi.fn(async (message: unknown) => {
      if (isHeartbeatMessage(message)) throw new Error("runtime disconnected");
      return { ok: true, data: defaultAppState };
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    const { ensureLauncher } = await import("./contentScript");
    ensureLauncher();
    await Promise.resolve();
    await Promise.resolve();

    const dot = document.querySelector<HTMLElement>("#linuxdo-friends-launcher .linuxdo-friends-launcher-status-dot");
    expect(dot?.textContent).toBe("×");
    expect(dot?.style.display).toBe("grid");
    expect(dot?.style.color).toBe("rgb(239, 68, 68)");
  });

  it("adds a friends tab to the user avatar menu and mounts the in-page app inside it", async () => {
    document.body.innerHTML = `
      <div class="user-menu revamped menu-panel">
        <div class="panel-body">
          <div class="panel-body-contents">
            <div class="quick-access-panel">native notifications</div>
            <div class="menu-tabs-container" role="tablist">
              <div class="top-tabs tabs-list">
                <a id="user-menu-button-all-notifications" class="btn btn-flat btn-icon no-text user-menu-tab active" role="tab" aria-selected="true">native</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    const { enhanceUserMenu } = await import("./contentScript");
    enhanceUserMenu();
    const tab = document.getElementById("linuxdo-friends-user-menu-tab") as HTMLButtonElement | null;
    expect(tab).toBeTruthy();

    tab?.click();
    await Promise.resolve();
    await Promise.resolve();

    const panel = document.getElementById("linuxdo-friends-user-menu-panel");
    const nativePanel = document.querySelector<HTMLElement>(".quick-access-panel");
    const pageStyle = document.getElementById("linuxdo-friends-page-style")?.textContent ?? "";
    expect(panel?.shadowRoot?.querySelector(".linuxdo-friends-menu-root")).toBeTruthy();
    expect(panel?.shadowRoot?.querySelector("style")?.textContent).toContain(".linuxdo-friends-menu-root .modal-backdrop");
    expect(panel?.shadowRoot?.querySelector("style")?.textContent).toContain("position: absolute");
    expect(panel?.shadowRoot?.querySelector("style")?.textContent).toContain("overflow-y: auto");
    expect(panel?.shadowRoot?.querySelector("style")?.textContent).toContain("height: auto");
    expect(panel?.shadowRoot?.querySelector("style")?.textContent).toContain(".linuxdo-friends-menu-root .modal-head .icon-button");
    expect(panel?.shadowRoot?.querySelector("style")?.textContent).toContain("grid-column: 2");
    expect(panel?.shadowRoot?.querySelector("style")?.textContent).toContain("grid-row: 1");
    expect(panel?.previousElementSibling?.className).toContain("menu-tabs-container");
    expect(tab?.querySelector("svg")?.className.baseVal).toContain("d-icon-user-group");
    expect(tab?.querySelector("use")?.getAttribute("href")).toBe("#user-group");
    expect(pageStyle).not.toContain("#linuxdo-friends-user-menu-tab svg");
    expect(nativePanel?.style.display).toBe("none");
    expect(tab?.className).toContain("active");
    expect(document.getElementById("user-menu-button-all-notifications")?.className).not.toContain("active");
  });

  it("adapts the friends tab panel to Discourse narrow slide-in user drawers", async () => {
    document.body.innerHTML = `
      <div class="user-menu revamped menu-panel show-avatars slide-in">
        <div class="panel-body">
          <div class="panel-body-contents">
            <div class="menu-tabs-container" role="tablist">
              <div class="top-tabs tabs-list">
                <a id="user-menu-button-all-notifications" class="btn btn-flat btn-icon no-text user-menu-tab active" role="tab" aria-selected="true">native</a>
              </div>
            </div>
            <div class="quick-access-panel">native notifications</div>
          </div>
        </div>
      </div>
    `;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    const { enhanceUserMenu } = await import("./contentScript");
    enhanceUserMenu();
    const tab = document.getElementById("linuxdo-friends-user-menu-tab") as HTMLButtonElement | null;

    tab?.click();
    await Promise.resolve();
    await Promise.resolve();

    const menu = document.querySelector<HTMLElement>(".user-menu");
    const panel = document.getElementById("linuxdo-friends-user-menu-panel");
    const pageStyle = document.getElementById("linuxdo-friends-page-style")?.textContent ?? "";
    expect(menu?.className).toContain("linuxdo-friends-user-menu-active");
    expect(menu?.className).toContain("linuxdo-friends-user-menu-drawer");
    expect(panel?.previousElementSibling?.className).toContain("menu-tabs-container");
    expect(pageStyle).toContain(".user-menu.linuxdo-friends-user-menu-active.linuxdo-friends-user-menu-drawer #linuxdo-friends-user-menu-panel");
    expect(pageStyle).toContain("width: calc(100% - 46px)");
  });

  it("extracts the current account without requesting following users", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ topic_list: { topics: [] } }), {
          status: 200,
          headers: { "x-discourse-username": "LaFish" }
        })
      )
    );

    await import("./contentScript");
    expect(listener).toBeTruthy();
    const response = await new Promise((resolve) => {
      listener?.({ type: "linuxdoFriends.extractCurrentAccount" }, {}, resolve);
    });

    expect(response).toMatchObject({ ok: true, username: "lafish" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/latest.json", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("extracts following users through same-origin page requests", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ topic_list: { topics: [] } }), {
            status: 200,
            headers: { "x-discourse-username": "LaFish" }
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([{ username: "Neil", name: "Neil", avatar_template: "/user_avatar/linux.do/neil/{size}/1.png" }]),
            { status: 200 }
          )
        )
    );

    await import("./contentScript");
    expect(listener).toBeTruthy();
    const response = await new Promise((resolve) => {
      listener?.({ type: "linuxdoFriends.extractFollowing" }, {}, resolve);
    });

    expect(response).toMatchObject({
      ok: true,
      username: "lafish",
      users: [
        {
          username: "Neil",
          name: "Neil",
          avatarUrl: "https://linux.do/user_avatar/linux.do/neil/48/1.png"
        }
      ]
    });
    expect(fetch).toHaveBeenNthCalledWith(1, "/latest.json", expect.objectContaining({ credentials: "same-origin" }));
    expect(fetch).toHaveBeenNthCalledWith(2, "/u/lafish/follow/following.json", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("extracts a user profile through a same-origin page request", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    const profilePayload = {
      user: {
        username: "Misaka7369",
        name: "御坂",
        avatar_template: "/user_avatar/linux.do/misaka7369/{size}/1.png",
        last_posted_at: "2026-06-28T00:10:00.000Z",
        last_seen_at: "2026-06-28T00:12:00.000Z"
      }
    };
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(profilePayload), { status: 200 })));

    await import("./contentScript");
    const response = await new Promise((resolve) => {
      listener?.({ type: "linuxdoFriends.extractProfile", username: "Misaka7369" }, {}, resolve);
    });

    expect(response).toMatchObject({
      ok: true,
      profile: {
        username: "misaka7369",
        name: "御坂",
        avatarUrl: "https://linux.do/user_avatar/linux.do/misaka7369/48/1.png",
        lastPostedAt: "2026-06-28T00:10:00.000Z",
        lastSeenAt: "2026-06-28T00:12:00.000Z"
      }
    });
    expect(fetch).toHaveBeenCalledWith("/u/misaka7369.json", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("keeps page profile extraction aligned with the direct profile parser", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    const profilePayload = {
      user: {
        username: "Misaka7369",
        name: "御坂",
        avatar_template: "/user_avatar/linux.do/misaka7369/{size}/1.png",
        last_posted_at: "2026-06-28T00:10:00.000Z",
        last_seen_at: "2026-06-28T00:12:00.000Z"
      }
    };
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(profilePayload), { status: 200 })));

    await import("./contentScript");
    const response = await new Promise<{ ok: true; profile: ReturnType<typeof extractFriendProfile> }>((resolve) => {
      listener?.({ type: "linuxdoFriends.extractProfile", username: "Misaka7369" }, {}, (value: unknown) => {
        resolve(value as { ok: true; profile: ReturnType<typeof extractFriendProfile> });
      });
    });
    const direct = extractFriendProfile(profilePayload);

    expect(response.ok).toBe(true);
    expect({ ...response.profile, refreshedAt: "stable" }).toEqual({ ...direct, refreshedAt: "stable" });
  });

  it("extracts avatars as data URLs through same-origin page requests", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "image/png" }),
          blob: async () => new Blob(["abc"], { type: "image/png" })
        } as Response
      )
    );

    await import("./contentScript");
    const response = await new Promise((resolve) => {
      listener?.(
        {
          type: "linuxdoFriends.extractAvatar",
          username: "Neil",
          avatarUrl: "https://linux.do/user_avatar/linux.do/neil/48/1.png"
        },
        {},
        resolve
      );
    });

    expect(response).toMatchObject({
      ok: true,
      username: "neil",
      sourceUrl: "https://linux.do/user_avatar/linux.do/neil/48/1.png",
      contentType: "image/png",
      byteLength: 3
    });
    expect((response as { dataUrl?: string }).dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(fetch).toHaveBeenCalledWith("/user_avatar/linux.do/neil/48/1.png", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("rejects avatar extraction for non-linux.do image URLs", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal("fetch", vi.fn());

    await import("./contentScript");
    const response = await new Promise((resolve) => {
      listener?.(
        {
          type: "linuxdoFriends.extractAvatar",
          username: "Neil",
          avatarUrl: "https://example.com/avatar.png"
        },
        {},
        resolve
      );
    });

    expect(response).toMatchObject({ ok: false, reason: "unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("extracts friend activity through same-origin page requests", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
            user_actions: [
              {
                id: 42,
                action_type: 5,
                topic_title: "一个近况",
                created_at: "2026-06-27T00:00:02.000Z",
                topic_id: 99,
                post_id: 42,
                post_url: "/t/example/42/1",
                acting_username: "Misaka7369"
              }
            ]
            }),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              boosts: [
                {
                  id: 43,
                  created_at: "2026-06-27T00:00:01.000Z",
                  user: { username: "Misaka7369" },
                  post: { topic_title: "一个 boost", id: 43 }
                }
              ]
            }),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                id: 44,
                created_at: "2026-06-27T00:00:00.000Z",
                user: { username: "Misaka7369" },
                post: { topic_title: "一个 reaction", id: 44 },
                reaction: { reaction_value: "hugs" }
              }
            ]),
            { status: 200 }
          )
        )
    );

    await import("./contentScript");
    expect(listener).toBeTruthy();
    const response = await new Promise((resolve) => {
      listener?.({ type: "linuxdoFriends.extractActivity", username: "Misaka7369" }, {}, resolve);
    });

    expect(response).toMatchObject({
      ok: true,
      activity: {
        username: "misaka7369",
        items: [
          {
            id: "user_action:misaka7369:5:99:42",
            username: "misaka7369",
            kind: "reply",
            title: "一个近况",
            url: "/t/example/42/1"
          },
          { id: "boost:43", kind: "boost", title: "一个 boost" },
          { id: "reaction:44", kind: "reaction", reactionValue: "hugs" }
        ]
      }
    });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/user_actions.json?offset=0&username=misaka7369&filter=4,5",
      expect.objectContaining({ credentials: "same-origin" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/discourse-boosts/users/misaka7369/boosts-given.json",
      expect.objectContaining({ credentials: "same-origin" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "/discourse-reactions/posts/reactions.json?username=misaka7369",
      expect.objectContaining({ credentials: "same-origin" })
    );
  });

  it.each([
    ["topic", "/user_actions.json?offset=0&username=misaka7369&filter=4"],
    ["reply", "/user_actions.json?offset=0&username=misaka7369&filter=5"],
    ["boost", "/discourse-boosts/users/misaka7369/boosts-given.json"],
    ["reaction", "/discourse-reactions/posts/reactions.json?username=misaka7369"]
  ] as const)("extracts only the scoped %s activity endpoint", async (kind, expectedPath) => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    const payload =
      kind === "boost"
        ? { boosts: [{ id: 1, user: { username: "Misaka7369" }, post: { topic_title: "boost" } }] }
        : kind === "reaction"
          ? [{ id: 1, user: { username: "Misaka7369" }, post: { topic_title: "reaction" }, reaction: { reaction_value: "hugs" } }]
          : { user_actions: [{ action_type: kind === "topic" ? 4 : 5, topic_id: 1, title: kind, acting_username: "Misaka7369" }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 })));

    await import("./contentScript");
    const response = await new Promise<{ ok: true; activity: ReturnType<typeof normalizeFriendActivity> }>((resolve) => {
      listener?.({ type: "linuxdoFriends.extractActivity", username: "Misaka7369", kind }, {}, (value: unknown) => {
        resolve(value as { ok: true; activity: ReturnType<typeof normalizeFriendActivity> });
      });
    });

    expect(response.ok).toBe(true);
    expect(response.activity.items).toHaveLength(1);
    expect(response.activity.items[0].kind).toBe(kind);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(expectedPath, expect.objectContaining({ credentials: "same-origin" }));
  });

  it("keeps page extraction semantics aligned with the direct normalization path", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    const userActionsPayload = {
      user_actions: [
        {
          action_type: 4,
          topic_id: 99,
          post_number: 1,
          created_at: "2026-06-27T00:00:03.000Z",
          acting_username: "Misaka7369",
          acting_name: "星",
          acting_avatar_template: "/user_avatar/linux.do/misaka7369/{size}/1.png",
          title: "一个主题",
          excerpt: "<p>hello&nbsp;topic</p>"
        }
      ]
    };
    const boostsPayload = {
      boosts: [
        {
          id: 43,
          raw: "<p>boost text</p>",
          created_at: "2026-06-27T00:00:02.000Z",
          user: { username: "Misaka7369", name: "星", avatar_template: "/user_avatar/linux.do/misaka7369/{size}/1.png" },
          post: { topic_title: "一个 boost", id: 43, username: "lafish", excerpt: "<strong>boosted</strong>" }
        }
      ]
    };
    const reactionsPayload = [
      {
        id: 44,
        created_at: "2026-06-27T00:00:01.000Z",
        user: { username: "Misaka7369", name: "星", avatar_template: "/user_avatar/linux.do/misaka7369/{size}/1.png" },
        post: { topic_title: "一个 reaction", id: 44, username: "lafish", excerpt: "reacted" },
        reaction: { reaction_value: "hugs" }
      }
    ];
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(userActionsPayload), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(boostsPayload), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(reactionsPayload), { status: 200 }))
    );

    await import("./contentScript");
    const response = await new Promise<{ ok: true; activity: ReturnType<typeof normalizeFriendActivity> }>((resolve) => {
      listener?.({ type: "linuxdoFriends.extractActivity", username: "Misaka7369" }, {}, (value: unknown) => {
        resolve(value as { ok: true; activity: ReturnType<typeof normalizeFriendActivity> });
      });
    });
    const direct = normalizeFriendActivity("Misaka7369", {
      userActions: extractUserActions(userActionsPayload),
      boosts: extractBoosts(boostsPayload),
      reactions: extractReactions(reactionsPayload)
    });

    expect(response.ok).toBe(true);
    expect(response.activity.items).toEqual(direct.items);
    expect(response.activity.lastPostAt).toEqual(direct.lastPostAt);
    expect(response.activity.coarseStatus).toEqual(direct.coarseStatus);
  });

  it("stops activity extraction when any endpoint returns a challenge", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ user_actions: [] }), { status: 200 }))
        .mockResolvedValueOnce(new Response("Enable JavaScript and cookies to continue", { status: 429 }))
    );

    await import("./contentScript");
    const response = await new Promise((resolve) => {
      listener?.({ type: "linuxdoFriends.extractActivity", username: "Misaka7369" }, {}, resolve);
    });

    expect(response).toMatchObject({ ok: false, reason: "challenge" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("stops profile extraction when the profile endpoint returns a challenge", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("Enable JavaScript and cookies to continue", { status: 429 })));

    await import("./contentScript");
    const response = await new Promise((resolve) => {
      listener?.({ type: "linuxdoFriends.extractProfile", username: "Misaka7369" }, {}, resolve);
    });

    expect(response).toMatchObject({ ok: false, reason: "challenge" });
    expect(fetch).toHaveBeenCalledWith("/u/misaka7369.json", expect.objectContaining({ credentials: "same-origin" }));
  });
});

function createMockLocalStorage() {
  const store = new Map<string, unknown>();
  return {
    async get(key: string) {
      return { [key]: store.get(key) };
    },
    async set(values: Record<string, unknown>) {
      for (const [key, value] of Object.entries(values)) {
        store.set(key, value);
      }
    }
  };
}

function isHeartbeatMessage(value: unknown): boolean {
  return typeof value === "object" && value != null && (value as { type?: unknown }).type === "linuxdoFriends.pageHeartbeat";
}

function isGetPageScriptStatusMessage(value: unknown): boolean {
  return typeof value === "object" && value != null && (value as { type?: unknown }).type === "getPageScriptStatus";
}
