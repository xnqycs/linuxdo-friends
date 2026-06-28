import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockStorage } from "../test/mockStorage";
import { uiSceneStorageKeys } from "../storage/uiSceneStorage";
import { loadUiSceneAtom, observeUiSceneAtom, resetUiSceneObserverForTest, uiSceneAtom, updateUiSceneAtom } from "./uiSceneAtoms";

describe("ui scene atoms", () => {
  beforeEach(() => {
    resetUiSceneObserverForTest();
    vi.unstubAllGlobals();
  });

  it("loads restored scene from session storage", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed",
      [uiSceneStorageKeys.feedKindFilter]: "reaction",
      [uiSceneStorageKeys.feedUserFilter]: "neo",
      [uiSceneStorageKeys.addFriendModalOpen]: true,
      [uiSceneStorageKeys.addFriendQuery]: "ada",
      [uiSceneStorageKeys.activityKindPopoverOpen]: true,
      [uiSceneStorageKeys.activityKindPopoverQuery]: "bo",
      [uiSceneStorageKeys.feedUserPopoverOpen]: true,
      [uiSceneStorageKeys.feedUserPopoverQuery]: "ne"
    });
    vi.stubGlobal("chrome", { storage: { session } });
    const store = createStore();

    await store.set(loadUiSceneAtom);

    expect(store.get(uiSceneAtom)).toMatchObject({
      tab: "feed",
      feedKindFilter: "reaction",
      feedUserFilter: "neo",
      addFriendModalOpen: true,
      addFriendQuery: "ada",
      activityKindPopover: { open: true, query: "bo" },
      feedUserPopover: { open: true, query: "ne" }
    });
  });

  it("writes only the changed scene fields", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    vi.stubGlobal("chrome", { storage: { session } });
    const store = createStore();

    await store.set(updateUiSceneAtom, { feedKindFilter: "boost" });

    expect(session.dump()).toEqual({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.feedKindFilter]: "boost"
    });
    expect(store.get(uiSceneAtom)).toMatchObject({ feedKindFilter: "boost" });
  });

  it("applies remote storage changes without whole-scene writeback", () => {
    let listener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | undefined;
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const setSpy = vi.spyOn(session, "set");
    vi.stubGlobal("chrome", {
      storage: {
        session,
        onChanged: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      }
    });
    const store = createStore();

    store.set(observeUiSceneAtom);
    listener?.({ [uiSceneStorageKeys.addFriendQuery]: { oldValue: "", newValue: "neo" } }, "session");

    expect(store.get(uiSceneAtom)).toMatchObject({ addFriendQuery: "neo" });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("fans remote scene changes out to multiple mounted surfaces", () => {
    let listener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | undefined;
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    vi.stubGlobal("chrome", {
      storage: {
        session,
        onChanged: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      }
    });
    const sidePanel = createStore();
    const inPage = createStore();

    sidePanel.set(observeUiSceneAtom);
    inPage.set(observeUiSceneAtom);
    listener?.({ [uiSceneStorageKeys.tab]: { oldValue: "friends", newValue: "feed" } }, "session");

    expect(sidePanel.get(uiSceneAtom).tab).toBe("feed");
    expect(inPage.get(uiSceneAtom).tab).toBe("feed");
  });

  it("removes unmounted scene observers from fan-out", () => {
    let listener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | undefined;
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    vi.stubGlobal("chrome", {
      storage: {
        session,
        onChanged: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      }
    });
    const sidePanel = createStore();
    const inPage = createStore();

    sidePanel.set(observeUiSceneAtom);
    const cleanup = inPage.set(observeUiSceneAtom);
    cleanup?.();
    listener?.({ [uiSceneStorageKeys.tab]: { oldValue: "friends", newValue: "feed" } }, "session");

    expect(sidePanel.get(uiSceneAtom).tab).toBe("feed");
    expect(inPage.get(uiSceneAtom).tab).toBe("friends");
  });

  it("preserves interleaved unrelated updates from two stores", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    vi.stubGlobal("chrome", { storage: { session } });
    const sidePanel = createStore();
    const inPage = createStore();

    await sidePanel.set(updateUiSceneAtom, { feedKindFilter: "boost" });
    await inPage.set(updateUiSceneAtom, { addFriendQuery: "neo" });

    const verifier = createStore();
    await verifier.set(loadUiSceneAtom);
    expect(verifier.get(uiSceneAtom)).toMatchObject({
      feedKindFilter: "boost",
      addFriendQuery: "neo"
    });
  });

  it("preserves interleaved nested popover field updates", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    vi.stubGlobal("chrome", { storage: { session } });
    const sidePanel = createStore();
    const inPage = createStore();

    await sidePanel.set(updateUiSceneAtom, { activityKindPopover: { open: true } });
    await inPage.set(updateUiSceneAtom, { activityKindPopover: { query: "bo" } });

    const verifier = createStore();
    await verifier.set(loadUiSceneAtom);
    expect(verifier.get(uiSceneAtom).activityKindPopover).toEqual({
      open: true,
      query: "bo"
    });
  });
});
