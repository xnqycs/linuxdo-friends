import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(resolve(__dirname, "../public/manifest.json"), "utf8"));

describe("extension manifest safety", () => {
  it("declares the MV3 extension surfaces inside the linux.do boundary", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.action.default_title).toBe("佬朋友");
    expect(manifest.action.default_popup).toBeUndefined();
    expect(manifest.side_panel.default_path).toBe("src/side-panel/index.html");
    expect(manifest.options_page).toBe("src/options/index.html");
    expect(manifest.background).toMatchObject({ service_worker: "service-worker.js", type: "module" });
    expect(manifest.content_scripts).toEqual([
      {
        matches: ["https://linux.do/*"],
        js: ["content-script.js"],
        run_at: "document_idle"
      }
    ]);
    expect(manifest.host_permissions).toEqual(["https://api.github.com/*", "https://linux.do/*"]);
  });

  it("does not request continuous polling, cookie, proxy, or external messaging surfaces", () => {
    expect(manifest.permissions).toEqual(["storage", "tabs", "sidePanel"]);
    expect(manifest.permissions).not.toContain("alarms");
    expect(manifest.permissions).not.toContain("cookies");
    expect(manifest.permissions).not.toContain("proxy");
    expect(manifest.permissions).not.toContain("webRequest");
    expect(manifest.permissions).not.toContain("declarativeNetRequest");
    expect(manifest.externally_connectable).toBeUndefined();
  });
});
