import { describe, expect, it } from "vitest";
import { createMockStorage } from "../test/mockStorage";
import {
  loadPageScriptStatusState,
  PAGE_SCRIPT_STATUS_STORAGE_KEY,
  pageScriptStatusFromStorageChanges,
  resetPageScriptStatusFallbackStorage,
  savePageScriptStatusState
} from "./pageScriptStatusStorage";

describe("page script status session storage", () => {
  it("saves and loads page script status snapshots", async () => {
    const storage = createMockStorage({});
    const status = {
      status: "connected" as const,
      connectedCount: 1,
      staleCount: 0,
      heartbeats: [
        {
          tabId: 123,
          url: "https://linux.do/",
          status: "ready" as const,
          hasLauncher: true,
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      ],
      selectedTabId: 123,
      updatedAt: "2026-06-28T00:00:00.000Z"
    };

    await savePageScriptStatusState(status, storage);

    await expect(loadPageScriptStatusState(storage)).resolves.toMatchObject({
      status: "connected",
      selectedTabId: 123,
      heartbeats: [{ tabId: 123, hasLauncher: true }]
    });
  });

  it("extracts page script status from session storage changes", () => {
    const status = pageScriptStatusFromStorageChanges({
      [PAGE_SCRIPT_STATUS_STORAGE_KEY]: {
        oldValue: null,
        newValue: {
          status: "challenge",
          connectedCount: 0,
          staleCount: 0,
          heartbeats: [
            {
              tabId: 456,
              url: "https://linux.do/t/topic/1",
              status: "challenge",
              hasLauncher: false,
              updatedAt: "2026-06-28T00:00:00.000Z"
            }
          ],
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      }
    });

    expect(status).toMatchObject({ status: "challenge", heartbeats: [{ tabId: 456, status: "challenge" }] });
  });

  it("uses a deterministic in-memory fallback without chrome storage", async () => {
    resetPageScriptStatusFallbackStorage();

    await savePageScriptStatusState(
      {
        status: "missing",
        connectedCount: 0,
        staleCount: 0,
        heartbeats: [],
        updatedAt: "2026-06-28T00:00:00.000Z"
      },
      null
    );

    await expect(loadPageScriptStatusState(null)).resolves.toMatchObject({ status: "missing" });
  });
});
