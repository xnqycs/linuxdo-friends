import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("content script build output", () => {
  it("remains self-contained after build", () => {
    const bundlePath = resolve(__dirname, "../../dist/content-script.js");
    if (!existsSync(bundlePath)) return;
    const bundle = readFileSync(bundlePath, "utf8");
    expect(bundle).not.toMatch(/^import\b|^export\b|import\(|import\{/m);
  });
});
