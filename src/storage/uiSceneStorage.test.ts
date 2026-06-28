import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockStorage } from "../test/mockStorage";
import {
  defaultUiSceneState,
  loadUiSceneState,
  patchUiSceneState,
  resetUiSceneFallbackStorage,
  uiSceneStorageKeys
} from "./uiSceneStorage";

describe("ui scene storage", () => {
  beforeEach(() => {
    resetUiSceneFallbackStorage();
    vi.unstubAllGlobals();
  });

  it("uses current UI defaults", () => {
    expect(defaultUiSceneState).toEqual({
      version: 1,
      tab: "friends",
      feedKindFilter: "all",
      feedUserFilter: "all",
      addFriendModalOpen: false,
      addFriendQuery: "",
      activityKindPopover: { open: false, query: "" },
      feedUserPopover: { open: false, query: "" }
    });
  });

  it("normalizes missing and malformed payloads to safe defaults", async () => {
    await expect(loadUiSceneState(createMockStorage({}))).resolves.toEqual(defaultUiSceneState);
    await expect(loadUiSceneState(createMockStorage({ [uiSceneStorageKeys.version]: 2 }))).resolves.toEqual(defaultUiSceneState);
    await expect(
      loadUiSceneState(
        createMockStorage({
          [uiSceneStorageKeys.version]: 1,
          [uiSceneStorageKeys.tab]: "bad",
          [uiSceneStorageKeys.feedKindFilter]: "summary",
          [uiSceneStorageKeys.feedUserFilter]: "",
          [uiSceneStorageKeys.addFriendModalOpen]: "yes",
          [uiSceneStorageKeys.addFriendQuery]: 42,
          [uiSceneStorageKeys.activityKindPopoverOpen]: "no",
          [uiSceneStorageKeys.activityKindPopoverQuery]: null
        })
      )
    ).resolves.toEqual(defaultUiSceneState);
  });

  it("reads and writes prefixed field keys only", async () => {
    const storage = createMockStorage({
      ignored: "keep",
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed"
    });

    await expect(loadUiSceneState(storage)).resolves.toMatchObject({ tab: "feed" });
    await patchUiSceneState({ feedKindFilter: "boost" }, storage);

    expect(storage.dump()).toEqual({
      ignored: "keep",
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed",
      [uiSceneStorageKeys.feedKindFilter]: "boost"
    });
  });

  it("prefers chrome.storage.session and does not touch local storage", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const local = createMockStorage({});
    vi.stubGlobal("chrome", {
      storage: {
        session,
        local
      }
    });

    await patchUiSceneState({ addFriendQuery: "neo" });

    expect(session.dump()).toMatchObject({ [uiSceneStorageKeys.addFriendQuery]: "neo" });
    expect(local.dump()).toEqual({});
  });

  it("uses deterministic in-memory fallback without chrome.storage.session", async () => {
    await patchUiSceneState({ tab: "feed", addFriendModalOpen: true }, null);

    await expect(loadUiSceneState(null)).resolves.toMatchObject({
      tab: "feed",
      addFriendModalOpen: true
    });
  });

  it("merges independent patches without losing unrelated fields", async () => {
    const storage = createMockStorage({ [uiSceneStorageKeys.version]: 1 });

    await patchUiSceneState({ feedKindFilter: "boost" }, storage);
    await patchUiSceneState({ addFriendQuery: "neo" }, storage);

    await expect(loadUiSceneState(storage)).resolves.toMatchObject({
      feedKindFilter: "boost",
      addFriendQuery: "neo"
    });
  });
});
