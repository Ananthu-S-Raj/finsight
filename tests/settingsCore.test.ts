import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_SETTINGS,
  readSettings,
  writeSettings,
  SETTINGS_KEY,
  type AppSettings,
} from "@/lib/settingsCore";

describe("settingsCore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns defaults when nothing is stored", () => {
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("merges stored settings over defaults", () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ haptic: false, soundEffects: false })
    );
    const s = readSettings();
    expect(s.haptic).toBe(false);
    expect(s.soundEffects).toBe(false);
    // untouched fields keep defaults
    expect(s.currency).toBe("INR");
    expect(s.notifications.push).toBe(false);
    expect(s.notifications.budgetAlerts).toBe(true);
  });

  it("merges nested notification prefs without clobbering", () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        notifications: { push: true, dailyReminders: false },
      })
    );
    const s = readSettings();
    expect(s.notifications.push).toBe(true);
    expect(s.notifications.dailyReminders).toBe(false);
    expect(s.notifications.budgetAlerts).toBe(true);
    expect(s.notifications.cardReminders).toBe(true);
  });

  it("falls back to defaults on corrupt JSON", () => {
    localStorage.setItem(SETTINGS_KEY, "{not json");
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("writeSettings round-trips", () => {
    const next: AppSettings = {
      ...DEFAULT_SETTINGS,
      haptic: false,
      notifications: { ...DEFAULT_SETTINGS.notifications, push: true },
    };
    writeSettings(next);
    expect(readSettings()).toEqual(next);
  });
});
