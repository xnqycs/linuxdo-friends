import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockStorage } from "../test/mockStorage";
import {
  AUTO_REFRESH_LEASE_TTL_MS,
  AUTO_REFRESH_SESSION_STORAGE_KEY,
  AUTO_REFRESH_SURFACE_STORAGE_PREFIX,
  claimAutoRefreshController,
  defaultAutoRefreshSession,
  loadAutoRefreshSessionState,
  normalizeAutoRefreshSession,
  patchAutoRefreshSessionState,
  registerAutoRefreshSurface,
  resetAutoRefreshSessionFallbackStorage,
  unregisterAutoRefreshSurface
} from "./autoRefreshSessionStorage";

describe("auto refresh session storage", () => {
  beforeEach(() => {
    resetAutoRefreshSessionFallbackStorage();
    vi.unstubAllGlobals();
  });

  it("normalizes missing and malformed values to disabled session defaults", async () => {
    await expect(loadAutoRefreshSessionState(createMockStorage({}), Date.parse("2026-06-28T00:00:00.000Z"))).resolves.toMatchObject({
      enabled: false,
      intervalMinutes: 10,
      visibleSurfaces: {}
    });
    expect(normalizeAutoRefreshSession({ enabled: true, intervalMinutes: 2, visibleSurfaces: "bad" })).toMatchObject({
      enabled: false,
      intervalMinutes: 10,
      visibleSurfaces: {},
      updatedAt: expect.any(String)
    });
    expect(defaultAutoRefreshSession("2026-06-28T00:00:00.000Z").updatedAt).toBe("2026-06-28T00:00:00.000Z");
  });

  it("accepts only 1, 10, and 30 minute intervals", async () => {
    const storage = createMockStorage({});

    await expect(patchAutoRefreshSessionState({ intervalMinutes: 1 }, storage)).resolves.toMatchObject({ intervalMinutes: 1 });
    await expect(patchAutoRefreshSessionState({ intervalMinutes: 30 }, storage)).resolves.toMatchObject({ intervalMinutes: 30 });
    expect(normalizeAutoRefreshSession({ intervalMinutes: 5 }).intervalMinutes).toBe(10);
  });

  it("registers and unregisters visible surfaces and disables when the last one closes", async () => {
    const storage = createMockStorage({});
    const now = Date.parse("2026-06-28T00:00:00.000Z");

    await registerAutoRefreshSurface("surface-a", "side-panel", storage, now);
    await patchAutoRefreshSessionState({ enabled: true }, storage, now + 1000);
    expect(await loadAutoRefreshSessionState(storage, now + 1000)).toMatchObject({
      enabled: true,
      enabledAt: "2026-06-28T00:00:01.000Z"
    });
    await unregisterAutoRefreshSurface("surface-a", storage, now + 2000);

    const closedSession = await loadAutoRefreshSessionState(storage, now + 2000);
    expect(closedSession.enabled).toBe(false);
    expect(closedSession).not.toHaveProperty("enabledAt");
  });

  it("keeps the enable timestamp stable across surface heartbeats", async () => {
    const storage = createMockStorage({});
    const now = Date.parse("2026-06-28T00:00:00.000Z");

    await registerAutoRefreshSurface("surface-a", "side-panel", storage, now);
    await patchAutoRefreshSessionState({ enabled: true }, storage, now + 1000);
    await registerAutoRefreshSurface("surface-a", "side-panel", storage, now + 15_000);

    expect(await loadAutoRefreshSessionState(storage, now + 15_000)).toMatchObject({
      enabled: true,
      enabledAt: "2026-06-28T00:00:01.000Z",
      updatedAt: "2026-06-28T00:00:01.000Z",
      visibleSurfaces: {
        "surface-a": {
          heartbeatAt: "2026-06-28T00:00:15.000Z"
        }
      }
    });
  });

  it("keeps config and finish timestamps when another surface heartbeats", async () => {
    const storage = createMockStorage({});
    const now = Date.parse("2026-06-28T00:00:00.000Z");

    await registerAutoRefreshSurface("surface-a", "side-panel", storage, now);
    await registerAutoRefreshSurface("surface-b", "in-page", storage, now);
    await patchAutoRefreshSessionState({ enabled: true, intervalMinutes: 1 }, storage, now + 1000);
    await patchAutoRefreshSessionState({ lastFinishedAt: "2026-06-28T00:02:00.000Z" }, storage, now + 2000);
    await registerAutoRefreshSurface("surface-b", "in-page", storage, now + 15_000);

    const session = await loadAutoRefreshSessionState(storage, now + 15_000);
    expect(session).toMatchObject({
      enabled: true,
      intervalMinutes: 1,
      enabledAt: "2026-06-28T00:00:01.000Z",
      lastFinishedAt: "2026-06-28T00:02:00.000Z"
    });
    expect(storage.dump()).toHaveProperty(`${AUTO_REFRESH_SURFACE_STORAGE_PREFIX}surface-a`);
    expect(storage.dump()).toHaveProperty(`${AUTO_REFRESH_SURFACE_STORAGE_PREFIX}surface-b`);
  });

  it("claims a controller only while the surface is visible, elected, and the previous lease is stale", async () => {
    const storage = createMockStorage({});
    const now = Date.parse("2026-06-28T00:00:00.000Z");
    await registerAutoRefreshSurface("surface-a", "side-panel", storage, now);
    await registerAutoRefreshSurface("surface-b", "in-page", storage, now);
    await patchAutoRefreshSessionState({ enabled: true }, storage, now);

    await expect(claimAutoRefreshController("surface-a", storage, now + 1000)).resolves.toMatchObject({
      controllerSurfaceId: "surface-a"
    });
    await expect(claimAutoRefreshController("surface-b", storage, now + 2000)).resolves.toMatchObject({
      controllerSurfaceId: "surface-a"
    });
    const expired = await claimAutoRefreshController("surface-b", storage, now + AUTO_REFRESH_LEASE_TTL_MS + 3000);
    expect(expired.controllerSurfaceId).toBeUndefined();
    await unregisterAutoRefreshSurface("surface-a", storage, now + AUTO_REFRESH_LEASE_TTL_MS + 4000);
    await registerAutoRefreshSurface("surface-b", "in-page", storage, now + AUTO_REFRESH_LEASE_TTL_MS + 4500);
    await patchAutoRefreshSessionState({ enabled: true }, storage, now + AUTO_REFRESH_LEASE_TTL_MS + 4600);
    await expect(claimAutoRefreshController("surface-b", storage, now + AUTO_REFRESH_LEASE_TTL_MS + 5000)).resolves.toMatchObject({
      controllerSurfaceId: "surface-b"
    });
  });

  it("prunes stale visible surfaces and stale controllers", async () => {
    const now = Date.parse("2026-06-28T00:10:00.000Z");
    const stale = new Date(now - AUTO_REFRESH_LEASE_TTL_MS - 1000).toISOString();
    const session = normalizeAutoRefreshSession(
      {
        enabled: true,
        intervalMinutes: 10,
        visibleSurfaces: {
          old: { surface: "side-panel", heartbeatAt: stale }
        },
        controllerSurfaceId: "old",
        controllerClaimedAt: stale,
        controllerHeartbeatAt: stale,
        updatedAt: stale
      },
      now
    );

    expect(session.visibleSurfaces).toEqual({});
    expect(session.enabled).toBe(false);
    expect(session.controllerSurfaceId).toBeUndefined();
  });

  it("prefers chrome storage session over local storage", async () => {
    const session = createMockStorage({});
    const local = createMockStorage({});
    vi.stubGlobal("chrome", { storage: { session, local } });

    await patchAutoRefreshSessionState({ intervalMinutes: 30 });

    expect(session.dump()).toHaveProperty(AUTO_REFRESH_SESSION_STORAGE_KEY);
    expect(local.dump()).toEqual({});
  });
});
