import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatRelativeTime(value?: string, now: Date | string | number = Date.now()): string {
  if (!value) return "未知";
  const then = dayjs(value);
  if (!then.isValid()) return "未知";
  return then.from(dayjs(now));
}
