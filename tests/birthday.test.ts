import { describe, it, expect } from "vitest";
import { birthdayStorageKey, isBirthdayToday } from "@/lib/birthday";

/** Builds a local-time Date (deterministic regardless of the runner's TZ). */
function localDate(year: number, month1: number, day: number, h = 12): Date {
  return new Date(year, month1 - 1, day, h, 0, 0, 0);
}

describe("isBirthdayToday", () => {
  it("is true when the profile birthday is today", () => {
    expect(isBirthdayToday("1998-08-21", localDate(2026, 8, 21))).toBe(true);
  });

  it("is false on any other day", () => {
    expect(isBirthdayToday("1998-08-21", localDate(2026, 8, 20))).toBe(false);
    expect(isBirthdayToday("1998-08-21", localDate(2026, 8, 22))).toBe(false);
    expect(isBirthdayToday("1998-08-21", localDate(2027, 8, 21))).toBe(true); // every year
  });

  it("ignores the year of birth — only month + day matter", () => {
    for (const year of [1900, 1998, 2000, 2024]) {
      expect(isBirthdayToday(`${year}-03-05`, localDate(2026, 3, 5))).toBe(true);
    }
  });

  it("treats missing/blank/invalid dates as not-a-birthday", () => {
    const today = localDate(2026, 8, 21);
    expect(isBirthdayToday(null, today)).toBe(false);
    expect(isBirthdayToday(undefined, today)).toBe(false);
    expect(isBirthdayToday("", today)).toBe(false);
    expect(isBirthdayToday("   ", today)).toBe(false);
    expect(isBirthdayToday("not-a-date", today)).toBe(false);
    expect(isBirthdayToday("21/08/1998", today)).toBe(false); // unexpected format
  });

  it("handles Feb 29 birthdays strictly (only on Feb 29)", () => {
    expect(isBirthdayToday("2000-02-29", localDate(2026, 2, 29))).toBe(false); // 2026 isn't a leap year
    expect(isBirthdayToday("2000-02-29", localDate(2028, 2, 29))).toBe(true);
  });

  it("flips at the local calendar day boundary, not the UTC day", () => {
    // Local one millisecond after midnight on the 21st.
    const justAfterMidnight = new Date(2026, 7, 21, 0, 0, 0, 1);
    expect(isBirthdayToday("1998-08-21", justAfterMidnight)).toBe(true);

    // Local one millisecond before midnight — still the previous LOCAL day.
    const justBefore = new Date(2026, 7, 20, 23, 59, 59, 999);
    expect(isBirthdayToday("1998-08-21", justBefore)).toBe(false);

    // Where the local and UTC days disagree at this instant, an implementation
    // reading UTC parts would give the opposite answer — this guards against
    // that regression on any runner timezone.
    if (justAfterMidnight.getUTCDate() !== justAfterMidnight.getDate()) {
      expect(isBirthdayToday("1998-08-21", justBefore)).toBe(false);
      expect(isBirthdayToday("1998-08-21", justAfterMidnight)).toBe(true);
    }
  });
});

describe("birthdayStorageKey", () => {
  it("is keyed by the local date so the greeting can return next year", () => {
    expect(birthdayStorageKey(localDate(2026, 8, 21))).toBe("finsight:birthday-shown:2026-08-21");
    expect(birthdayStorageKey(localDate(2027, 1, 9))).toBe("finsight:birthday-shown:2027-01-09");
  });
});
