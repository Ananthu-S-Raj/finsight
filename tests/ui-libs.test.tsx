// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { REFRESH_EVENT, emitRefresh, listenRefresh } from "@/lib/events";
import { SETTINGS_KEY, DEFAULT_SETTINGS } from "@/lib/settingsCore";

function metaThemeColor() {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  return meta;
}

function stubMatchMedia(listeners: Function[], matches = false) {
  vi.stubGlobal("window", {
    ...window,
    matchMedia: () => ({
      matches,
      addEventListener: (_: string, cb: Function) => listeners.push(cb),
      removeEventListener: () => {},
    }),
  });
}

async function freshSettings() {
  return await import("@/lib/settings");
}

describe("events.ts — refresh bus", () => {
  it("dispatches the finsight:refresh event on emitRefresh", () => {
    const spy = vi.fn();
    const off = listenRefresh(spy);
    emitRefresh();
    expect(spy).toHaveBeenCalledTimes(1);
    off();
    emitRefresh();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("stops listening after unsubscribe", () => {
    const spy = vi.fn();
    const off = listenRefresh(spy);
    off();
    emitRefresh();
    emitRefresh();
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects unknown listeners of a custom event name", () => {
    // The bus only reacts to finsight:refresh, never to arbitrary events.
    const spy = vi.fn();
    listenRefresh(spy);
    window.dispatchEvent(new CustomEvent("some:other"));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("settings.ts — applyTheme", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.removeItem(SETTINGS_KEY);
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
    document.documentElement.classList.remove("theme-anim");
    metaThemeColor().content = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("applies dark mode to the html element and theme-color meta", async () => {
    stubMatchMedia([], false);
    const { applyTheme } = await freshSettings();
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(metaThemeColor().content).toBe("#0B0F14");
  });

  it("applies light mode and its meta color", async () => {
    stubMatchMedia([], false);
    const { applyTheme } = await freshSettings();
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(metaThemeColor().content).toBe("#F8FAFC");
  });

  it("resolves system theme from the OS preference", async () => {
    stubMatchMedia([], true);
    const { applyTheme } = await freshSettings();
    applyTheme("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("adds a transient animation class when animate is requested", async () => {
    vi.useFakeTimers();
    stubMatchMedia([], false);
    const { applyTheme } = await freshSettings();
    applyTheme("dark", true);
    expect(document.documentElement.classList.contains("theme-anim")).toBe(true);
    vi.advanceTimersByTime(301);
    expect(document.documentElement.classList.contains("theme-anim")).toBe(false);
  });
});

describe("settings.ts — ensureSystemThemeListener", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.removeItem(SETTINGS_KEY);
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers a single OS color-scheme listener", async () => {
    const listeners: Function[] = [];
    stubMatchMedia(listeners, false);
    const { ensureSystemThemeListener } = await freshSettings();
    ensureSystemThemeListener();
    ensureSystemThemeListener();
    expect(listeners.length).toBe(1);
  });

  it("re-applies the theme when the OS scheme flips while in system mode", async () => {
    const listeners: Function[] = [];
    stubMatchMedia(listeners, true);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, theme: "system" }));
    const { ensureSystemThemeListener } = await freshSettings();
    ensureSystemThemeListener();
    expect(listeners.length).toBe(1);
    listeners[0]();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
