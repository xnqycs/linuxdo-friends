import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeActivity } from "../domain/activity";

describe("no online tracking policy", () => {
  it("normalizes activity without precise online timeline fields", () => {
    const summary = normalizeActivity("neil", [
      {
        id: 1,
        action_type: 5,
        title: "A topic",
        created_at: "2026-06-27T00:00:00.000Z",
        post_url: "/t/example/1"
      }
    ]);
    expect(summary).not.toHaveProperty("lastSeenAt");
    expect(summary).not.toHaveProperty("online");
    expect(summary.coarseStatus).toBeTruthy();
  });

  it("does not render feed excerpts through raw HTML injection", () => {
    const appSource = readFileSync(resolve(__dirname, "../app/FriendsApp.tsx"), "utf8");
    expect(appSource).not.toContain(`dangerouslySet${"InnerHTML"}`);
  });
});
