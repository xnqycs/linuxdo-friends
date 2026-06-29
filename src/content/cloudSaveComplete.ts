const cloudSaveAppId = "linuxdo-friends";
const messageType = "cloudSaveExchangeCode";

void completeCloudSaveAuth();

export function readExchangeCode(locationHref: string = location.href, documentRef: Document = document): string | null {
  const urlCode = new URL(locationHref).searchParams.get("code");
  if (urlCode?.trim()) return urlCode;
  return documentRef.querySelector('meta[name="cloud-save-exchange-code"]')?.getAttribute("content")?.trim() || null;
}

export function readExchangeApp(locationHref: string = location.href, documentRef: Document = document): string | null {
  const urlApp = new URL(locationHref).searchParams.get("app");
  if (urlApp?.trim()) return urlApp;
  return documentRef.querySelector('meta[name="cloud-save-app"]')?.getAttribute("content")?.trim() || null;
}

async function completeCloudSaveAuth() {
  const code = readExchangeCode();
  const app = readExchangeApp();
  if (!code || (app && app !== cloudSaveAppId)) return;
  try {
    await chrome.runtime.sendMessage({ type: messageType, code });
  } catch {
    // The completion page is best-effort; the service worker owns the exchange.
  }
}
