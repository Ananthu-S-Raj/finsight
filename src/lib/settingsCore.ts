export type ThemeMode = "dark" | "light" | "system";

export type NotificationPrefs = {
  push: boolean;
  budgetAlerts: boolean;
  dailyReminders: boolean;
  cardReminders: boolean;
  loanReminders: boolean;
  savingsNotifications: boolean;
  billReminders: boolean;
  goalReminders: boolean;
};

export type AppSettings = {
  theme: ThemeMode;
  reduceMotion: boolean;
  hideBalancesByDefault: boolean;
  maskValues: boolean;
  currency: string;
  aiEnabled: boolean;
  soundEffects: boolean;
  notificationSounds: boolean;
  haptic: boolean;
  notifications: NotificationPrefs;
};

export const SETTINGS_KEY = "finsight:settings";

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  reduceMotion: false,
  hideBalancesByDefault: false,
  maskValues: false,
  currency: "INR",
  aiEnabled: true,
  soundEffects: true,
  notificationSounds: true,
  haptic: true,
  notifications: {
    push: false,
    budgetAlerts: true,
    dailyReminders: true,
    cardReminders: true,
    loanReminders: true,
    savingsNotifications: true,
    billReminders: true,
    goalReminders: true,
  },
};

/** Reads + merges stored settings. Safe to call anywhere (SSR-safe, never throws). */
export function readSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      notifications: {
        ...DEFAULT_SETTINGS.notifications,
        ...(parsed.notifications ?? {}),
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(settings: AppSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable
  }
}
