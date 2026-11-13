import { afterAll, describe, expect, it } from "vitest";
import { nextLocalDay } from "./review-day";

const originalTimezone = process.env.TZ;
afterAll(() => { process.env.TZ = originalTimezone; });

describe("due-today exclusive local calendar boundary", () => {
  it("includes later today and overdue dates but excludes tomorrow", () => {
    process.env.TZ = "Asia/Manila";
    const boundary = nextLocalDay(new Date("2026-12-31T09:00:00+08:00"));
    expect(boundary.toISOString()).toBe("2026-12-31T16:00:00.000Z");
    expect(new Date("2026-12-31T15:00:00+08:00") < boundary).toBe(true);
    expect(new Date("2026-12-30T15:00:00+08:00") < boundary).toBe(true);
    expect(new Date("2027-01-01T00:00:00+08:00") < boundary).toBe(false);
  });

  it.each([
    ["2026-03-08T00:00:00-05:00", "2026-03-09T04:00:00.000Z", 23],
    ["2026-11-01T00:00:00-04:00", "2026-11-02T05:00:00.000Z", 25],
  ])("uses local midnight across DST for %s", (input, expected, hours) => {
    process.env.TZ = "America/New_York";
    const now = new Date(input);
    const boundary = nextLocalDay(now);
    expect(boundary.toISOString()).toBe(expected);
    expect((boundary.getTime() - now.getTime()) / 3_600_000).toBe(hours);
  });
});
