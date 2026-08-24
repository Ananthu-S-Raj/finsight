/**
 * Birthday helpers for the startup greeting.
 *
 * "Today" always comes from the device's local clock — the same convention
 * the rest of the app uses (month summaries, time-ago labels, en-IN date
 * formatting all use local time). Comparing local month/day means the
 * birthday flips at the user's own midnight, never at UTC midnight, so a
 * 1998-08-21 birthday matches on Aug 21 in India regardless of year.
 */

/** True when `dateOfBirth`'s month + day match today's local month + day. */
export function isBirthdayToday(
  dateOfBirth: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!dateOfBirth) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateOfBirth).trim());
  if (!m) return false;
  return now.getMonth() + 1 === Number(m[2]) && now.getDate() === Number(m[3]);
}

/**
 * sessionStorage key that marks the greeting as shown. Keyed by the local
 * date so the greeting can appear again next year (or tomorrow, for tests).
 */
export function birthdayStorageKey(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `finsight:birthday-shown:${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
