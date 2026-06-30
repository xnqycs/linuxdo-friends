import type { ActivityItem, ActivityKind, AppState } from "../shared/types";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const LINUXDO_BASE = "https://linux.do";
const MAX_MESSAGE_LENGTH = 4096;

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "MarkdownV2", disable_web_page_preview: true })
    });
    const json = (await response.json()) as { ok: boolean; description?: string };
    if (!json.ok) {
      return { ok: false, error: json.description ?? "Telegram API 返回错误。" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "网络请求失败。" };
  }
}

export async function maybeSendTelegramNotifications(state: AppState): Promise<void> {
  const { telegramBotToken, telegramChatId } = state.settings;
  if (!telegramBotToken || !telegramChatId) return;

  const newItems: ActivityItem[] = [];
  for (const summary of Object.values(state.activity)) {
    for (const item of summary.items) {
      if (item.isNew) newItems.push(item);
    }
  }
  if (newItems.length === 0) return;

  const batches = buildMessageBatches(newItems);
  for (const text of batches) {
    await sendTelegramMessage(telegramBotToken, telegramChatId, text);
  }
}

function buildMessageBatches(items: ActivityItem[]): string[] {
  const header = escapeMd(`🔔 佬朋友有 ${items.length} 条新动态`) + "\n";
  const lines = items.map(formatItem);
  const batches: string[] = [];
  let current = header;
  for (const line of lines) {
    const next = current + "\n" + line;
    if (next.length > MAX_MESSAGE_LENGTH) {
      batches.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) batches.push(current);
  return batches;
}

function formatItem(item: ActivityItem): string {
  const kindLabel = activityKindLabel(item.kind);
  const title = `*@${escapeMd(item.username)}* ${escapeMd(kindLabel + "：" + item.title)}`;
  const absoluteUrl = toAbsoluteUrl(item.url);
  const link = absoluteUrl ? ` [查看](${absoluteUrl})` : "";
  return title + link;
}

function toAbsoluteUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${LINUXDO_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

function activityKindLabel(kind: ActivityKind): string {
  if (kind === "topic") return "话题";
  if (kind === "reply") return "回复";
  if (kind === "boost") return "Boost";
  if (kind === "reaction") return "回应";
  return kind;
}

// MarkdownV2 requires escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
function escapeMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}
