import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./time";

describe("time formatting", () => {
  it("formats relative time through the zh-cn dayjs locale", () => {
    expect(formatRelativeTime("2026-06-28T00:01:00.000Z", "2026-06-28T00:02:00.000Z")).toBe("1 分钟前");
  });

  it("keeps invalid or missing values explicit", () => {
    expect(formatRelativeTime()).toBe("未知");
    expect(formatRelativeTime("not-a-date")).toBe("未知");
  });
});
