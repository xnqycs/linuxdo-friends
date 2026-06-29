import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("cloud-save completion content script", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads exchange code and app from the URL or meta tags", async () => {
    const { readExchangeApp, readExchangeCode } = await import("./cloudSaveComplete");
    const metaCode = document.createElement("meta");
    metaCode.name = "cloud-save-exchange-code";
    metaCode.content = "meta-code";
    const metaApp = document.createElement("meta");
    metaApp.name = "cloud-save-app";
    metaApp.content = "linuxdo-friends";
    document.head.append(metaCode, metaApp);

    expect(readExchangeCode("https://linuxdo-cloud-save.lafish.workers.dev/auth/complete/browser_code?code=url-code")).toBe("url-code");
    expect(readExchangeCode("https://linuxdo-cloud-save.lafish.workers.dev/auth/complete/browser_code")).toBe("meta-code");
    expect(readExchangeApp("https://linuxdo-cloud-save.lafish.workers.dev/auth/complete/browser_code?app=url-app")).toBe("url-app");
    expect(readExchangeApp("https://linuxdo-cloud-save.lafish.workers.dev/auth/complete/browser_code")).toBe("linuxdo-friends");
  });

  it("sends the one-time exchange code for linuxdo-friends", async () => {
    const sendMessage = vi.fn(async () => undefined);
    stubChrome(sendMessage);
    setLocation("/auth/complete/browser_code?app=linuxdo-friends&code=code-1");

    await importFreshCompletionScript();

    expect(sendMessage).toHaveBeenCalledWith({ type: "cloudSaveExchangeCode", code: "code-1" });
    expect(JSON.stringify(sendMessage.mock.calls)).not.toContain("secret-token");
  });

  it("falls back to the meta exchange code when URL query is empty", async () => {
    const sendMessage = vi.fn(async () => undefined);
    stubChrome(sendMessage);
    setLocation("/auth/complete/browser_code");
    const metaCode = document.createElement("meta");
    metaCode.name = "cloud-save-exchange-code";
    metaCode.content = "meta-code";
    const metaApp = document.createElement("meta");
    metaApp.name = "cloud-save-app";
    metaApp.content = "linuxdo-friends";
    document.head.append(metaCode, metaApp);

    await importFreshCompletionScript();

    expect(sendMessage).toHaveBeenCalledWith({ type: "cloudSaveExchangeCode", code: "meta-code" });
  });

  it("does not send codes for other apps or missing codes", async () => {
    const sendMessage = vi.fn(async () => undefined);
    stubChrome(sendMessage);
    setLocation("/auth/complete/browser_code?app=other&code=code-1");

    await importFreshCompletionScript();
    expect(sendMessage).not.toHaveBeenCalled();

    vi.resetModules();
    setLocation("/auth/complete/browser_code?app=linuxdo-friends");
    await importFreshCompletionScript();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

async function importFreshCompletionScript() {
  vi.resetModules();
  await import("./cloudSaveComplete");
  await Promise.resolve();
}

function stubChrome(sendMessage: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage
    }
  });
}

function setLocation(href: string) {
  window.history.replaceState(null, "", href);
}
