"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  readSettings,
  writeSettings,
  type AppSettings,
  type NotificationPrefs,
  type ThemeMode,
} from "./settingsCore";

export type { AppSettings, NotificationPrefs, ThemeMode };

const KEY = "finsight:settings";

/**
 * Resolve a ThemeMode to the effective "dark"|"light" value and apply it to
 * <html data-theme> plus <meta name="theme-color">. Safe to call at any time;
 * idempotent. `animate` briefly enables a cross-fade on the document root.
 */
export function applyTheme(theme: ThemeMode, animate = false) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  const resolved: "dark" | "light" =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : theme;

  if (animate) {
    html.classList.add("theme-anim");
    const root = html as HTMLElement & { __themeTimer?: ReturnType<typeof setTimeout> };
    clearTimeout(root.__themeTimer);
    root.__themeTimer = setTimeout(() => html.classList.remove("theme-anim"), 300);
  }

  html.setAttribute("data-theme", resolved);
  html.style.colorScheme = resolved;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = resolved === "light" ? "#F8FAFC" : "#0B0F14";
}

let osListenerActive = false;

/**
 * When the stored preference is "system", live-follow OS color-scheme changes.
 * The listener is registered once per document load.
 */
export function ensureSystemThemeListener() {
  if (typeof window === "undefined" || osListenerActive) return;
  osListenerActive = true;
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const onChange = () => {
    if (readSettings().theme === "system") applyTheme("system");
  };
  mq.addEventListener("change", onChange);
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSettings(readSettings());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    writeSettings(settings);

    const html = document.documentElement;
    applyTheme(settings.theme);
    ensureSystemThemeListener();
    if (settings.reduceMotion) html.setAttribute("data-reduced-motion", "true");
    else html.removeAttribute("data-reduced-motion");
  }, [settings, ready]);

  const patch = (partial: Partial<AppSettings>) =>
    setSettings((s) => ({ ...s, ...partial }));
  const patchNotifications = (partial: Partial<NotificationPrefs>) =>
    setSettings((s) => ({
      ...s,
      notifications: { ...s.notifications, ...partial },
    }));

  return { settings, ready, patch, patchNotifications };
}
