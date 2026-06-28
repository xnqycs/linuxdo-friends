import { describe, expect, it } from "vitest";
import { normalizeUpdateCheckState } from "./updateCheckStorage";

describe("update check storage", () => {
  it("recomputes cached update availability against the current installed version", () => {
    const state = normalizeUpdateCheckState(
      {
        installedVersion: "1.0.0",
        latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
        status: "update-available",
        latestVersion: "1.0.1",
        checkedAt: "2026-06-28T00:00:00.000Z",
        source: "github_release"
      },
      "1.0.1"
    );

    expect(state).toMatchObject({
      installedVersion: "1.0.1",
      latestVersion: "1.0.1",
      status: "up-to-date"
    });
  });
});
