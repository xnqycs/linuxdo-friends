import type { RefreshFailureReason } from "../shared/types";

export type ClassifiedResponse =
  | { ok: true; json: unknown }
  | { ok: false; reason: RefreshFailureReason; message: string };

export async function classifyFetchResponse(response: Response): Promise<ClassifiedResponse> {
  const text = await response.text();
  if (looksLikeChallenge(text)) {
    return { ok: false, reason: "challenge", message: "遇到浏览器验证页面，已停止请求。" };
  }
  if (response.status === 403) {
    return { ok: false, reason: "blocked", message: "linux.do 拒绝了本次请求，已停止重试。" };
  }
  if (response.status === 429) {
    return { ok: false, reason: "rate_limited", message: "linux.do 返回限流，已停止重试。" };
  }
  if (!response.ok) {
    return { ok: false, reason: "network_error", message: `请求失败：${response.status}` };
  }
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "invalid_response", message: "响应不是可解析的 JSON。" };
  }
}

export function looksLikeChallenge(text: string): boolean {
  const lowered = text.slice(0, 4000).toLowerCase();
  return (
    lowered.includes("cf-mitigated") ||
    lowered.includes("just a moment") ||
    lowered.includes("challenge-error-text") ||
    lowered.includes("enable javascript and cookies")
  );
}
