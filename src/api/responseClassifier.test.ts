import { describe, expect, it } from "vitest";
import { classifyFetchResponse, looksLikeChallenge } from "./responseClassifier";

describe("response classifier", () => {
  it("classifies 403 as blocked", async () => {
    const result = await classifyFetchResponse(new Response("no", { status: 403 }));
    expect(result).toMatchObject({ ok: false, reason: "blocked" });
  });

  it("classifies 429 as rate limited", async () => {
    const result = await classifyFetchResponse(new Response("slow", { status: 429 }));
    expect(result).toMatchObject({ ok: false, reason: "rate_limited" });
  });

  it("classifies challenge text before status-specific 429 handling", async () => {
    const result = await classifyFetchResponse(new Response("Enable JavaScript and cookies to continue", { status: 429 }));
    expect(result).toMatchObject({ ok: false, reason: "challenge" });
  });

  it("classifies challenge pages", async () => {
    const body = "<html><title>Just a moment...</title><span id='challenge-error-text'></span></html>";
    const result = await classifyFetchResponse(new Response(body, { status: 200 }));
    expect(result).toMatchObject({ ok: false, reason: "challenge" });
    expect(looksLikeChallenge(body)).toBe(true);
  });

  it("parses valid JSON", async () => {
    const result = await classifyFetchResponse(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    expect(result).toMatchObject({ ok: true, json: { ok: true } });
  });
});
