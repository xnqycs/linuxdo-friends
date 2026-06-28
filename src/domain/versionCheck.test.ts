import { describe, expect, it } from "vitest";
import {
  compareVersions,
  isNewerVersion,
  isUpdateCheckCacheFresh,
  normalizeVersionTag,
  updateCheckStateFromRelease
} from "./versionCheck";

describe("version update check helpers", () => {
  it("normalizes three-part release versions with optional v prefix", () => {
    expect(normalizeVersionTag("v1.2.3")).toBe("1.2.3");
    expect(normalizeVersionTag("1.2.3")).toBe("1.2.3");
    expect(normalizeVersionTag("v01.002.0003")).toBe("1.2.3");
    expect(normalizeVersionTag("latest")).toBeNull();
  });

  it("compares normalized release versions without adding a dependency", () => {
    expect(compareVersions("v1.0.1", "1.0.0")).toBe(1);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("v0.9.9", "1.0.0")).toBe(-1);
    expect(compareVersions("invalid", "1.0.0")).toBeNull();
    expect(isNewerVersion("v1.0.1", "1.0.0")).toBe(true);
  });

  it("turns a GitHub latest release payload into update state", () => {
    const state = updateCheckStateFromRelease(
      "1.0.0",
      { tag_name: "v1.1.0", html_url: "https://github.com/LeUKi/linuxdo-friends/releases/tag/v1.1.0" },
      "2026-06-28T00:00:00.000Z"
    );

    expect(state).toMatchObject({
      status: "update-available",
      installedVersion: "1.0.0",
      latestVersion: "1.1.0",
      checkedAt: "2026-06-28T00:00:00.000Z"
    });
  });

  it("honors the 12-hour cache TTL", () => {
    expect(
      isUpdateCheckCacheFresh(
        {
          installedVersion: "1.0.0",
          latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
          status: "up-to-date",
          checkedAt: "2026-06-28T00:00:00.000Z"
        },
        Date.parse("2026-06-28T11:59:59.000Z")
      )
    ).toBe(true);
    expect(
      isUpdateCheckCacheFresh(
        {
          installedVersion: "1.0.0",
          latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
          status: "up-to-date",
          checkedAt: "2026-06-28T00:00:00.000Z"
        },
        Date.parse("2026-06-28T12:00:00.000Z")
      )
    ).toBe(false);
  });
});
