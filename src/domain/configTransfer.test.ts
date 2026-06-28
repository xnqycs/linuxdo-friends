import { describe, expect, it } from "vitest";
import { defaultAppState } from "./defaultState";
import { createConfigExport, parseConfigImportJson, applyConfigImport } from "./configTransfer";

describe("config transfer", () => {
  it("exports only migratable config", () => {
    const file = createConfigExport(
      {
        ...defaultAppState,
        followedUsers: {
          neo: { username: "neo", source: "sync", followedAt: "2026-06-28T00:00:00.000Z", updatedAt: "2026-06-28T00:00:00.000Z" }
        },
        friends: {
          neo: {
            username: "neo",
            note: "NAS",
            groups: ["ops"],
            pinned: true,
            upgradedAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z"
          }
        },
        activity: { neo: { username: "neo", refreshedAt: "2026-06-28T00:00:00.000Z", items: [] } },
        currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" }
      },
      "2026-06-28T00:00:00.000Z"
    );

    expect(file).toEqual({
      schemaVersion: 1,
      source: "linuxdo-friends",
      exportedAt: "2026-06-28T00:00:00.000Z",
      friends: {
        neo: {
          username: "neo",
          note: "NAS",
          groups: ["ops"],
          pinned: true,
          upgradedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      settings: defaultAppState.settings
    });
    expect(JSON.stringify(file)).not.toContain("currentAccount");
    expect(JSON.stringify(file)).not.toContain("followedUsers");
    expect(JSON.stringify(file)).not.toContain("activity");
  });

  it("normalizes valid import files", () => {
    const file = parseConfigImportJson(
      JSON.stringify({
        schemaVersion: 1,
        source: "linuxdo-friends",
        exportedAt: "2026-06-28T00:00:00.000Z",
        friends: {
          Neo: {
            username: "@Neo",
            note: "NAS",
            groups: ["ops", "ops", ""],
            pinned: true,
            upgradedAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z"
          }
        },
        settings: { refreshIntervalMinutes: 60, allowAutoRefresh: true, allowInactiveTabFallback: true }
      })
    );

    expect(file.friends.neo).toMatchObject({ username: "neo", groups: ["ops"], pinned: true });
    expect(file.settings).toEqual({ allowAutoRefresh: false, allowInactiveTabFallback: false, refreshIntervalMinutes: 60 });
  });

  it("rejects invalid import files", () => {
    expect(() => parseConfigImportJson("{")).toThrow("配置文件不是有效的 JSON。");
    expect(() => parseConfigImportJson(JSON.stringify({ schemaVersion: 2, source: "linuxdo-friends" }))).toThrow("配置文件版本不支持。");
    expect(() =>
      parseConfigImportJson(
        JSON.stringify({
          schemaVersion: 1,
          source: "linuxdo-friends",
          exportedAt: "2026-06-28T00:00:00.000Z",
          friends: {},
          settings: { refreshIntervalMinutes: "bad" }
        })
      )
    ).toThrow("配置文件的刷新间隔不正确。");
    expect(() =>
      parseConfigImportJson(
        JSON.stringify({
          schemaVersion: 1,
          source: "linuxdo-friends",
          exportedAt: "2026-06-28T00:00:00.000Z",
          friends: { neo: { username: "neo", groups: [1] } },
          settings: {}
        })
      )
    ).toThrow("佬朋友分组格式不正确。");
  });

  it("applies import as overwrite and clears derived state", () => {
    const file = parseConfigImportJson(
      JSON.stringify({
        schemaVersion: 1,
        source: "linuxdo-friends",
        exportedAt: "2026-06-28T00:00:00.000Z",
        friends: {
          neo: {
            username: "neo",
            note: "",
            groups: [],
            pinned: false,
            upgradedAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z"
          }
        },
        settings: { refreshIntervalMinutes: 90 }
      })
    );
    const { state } = applyConfigImport(file, "2026-06-28T00:01:00.000Z");

    expect(state.friends).toEqual(file.friends);
    expect(state.settings.refreshIntervalMinutes).toBe(90);
    expect(state.activity).toEqual({});
    expect(state.currentAccount).toBeUndefined();
    expect(state.lastSync?.message).toBe("已导入 1 位佬朋友配置。");
  });
});
