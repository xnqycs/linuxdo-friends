import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_REFRESH_SESSION_STORAGE_KEY } from "../storage/autoRefreshSessionStorage";
import { createMockStorage } from "../test/mockStorage";
import {
  autoRefreshSessionAtom,
  observeAutoRefreshSessionAtom,
  resetAutoRefreshSessionObserverForTest,
  updateAutoRefreshEnabledAtom,
  updateAutoRefreshIntervalAtom
} from "./autoRefreshAtoms";

describe("auto refresh session atoms", () => {
  beforeEach(() => {
    resetAutoRefreshSessionObserverForTest();
    vi.unstubAllGlobals();
  });

  it("fans session changes out to mounted surfaces", async () => {
    let storageListener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | undefined;
    const session = createMockStorage({
      [AUTO_REFRESH_SESSION_STORAGE_KEY]: {
        enabled: true,
        intervalMinutes: 30,
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });
    vi.stubGlobal("chrome", {
      storage: {
        session,
        onChanged: {
          addListener: vi.fn((callback) => {
            storageListener = callback;
          })
        }
      }
    });
    const sidePanelStore = createStore();
    const inPageStore = createStore();

    sidePanelStore.set(observeAutoRefreshSessionAtom);
    inPageStore.set(observeAutoRefreshSessionAtom);
    storageListener?.(
      {
        [AUTO_REFRESH_SESSION_STORAGE_KEY]: {
          oldValue: null,
          newValue: {
            enabled: true,
            intervalMinutes: 30,
            visibleSurfaces: {},
            updatedAt: "2026-06-28T00:00:00.000Z"
          }
        }
      },
      "session"
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(sidePanelStore.get(autoRefreshSessionAtom).intervalMinutes).toBe(30);
    expect(inPageStore.get(autoRefreshSessionAtom).enabled).toBe(false);
  });

  it("writes toggle and interval changes through session storage", async () => {
    const session = createMockStorage({});
    vi.stubGlobal("chrome", {
      storage: {
        session,
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    const store = createStore();

    await store.set(updateAutoRefreshIntervalAtom, 1);
    await store.set(updateAutoRefreshEnabledAtom, true);

    expect(session.dump()[AUTO_REFRESH_SESSION_STORAGE_KEY]).toMatchObject({
      intervalMinutes: 1,
      enabled: false
    });
  });
});
