import { describe, expect, it, beforeEach, vi } from "vitest";

const vibrate = vi.fn();

async function freshHaptic() {
  vi.resetModules();
  return await import("@/lib/haptics");
}

describe("haptics", () => {
  beforeEach(() => {
    vibrate.mockClear();
    localStorage.clear();
  });

  it("skips when navigator.vibrate is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const { haptic } = await freshHaptic();
    expect(() => haptic("light")).not.toThrow();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("fires vibrate when supported and enabled", async () => {
    vi.stubGlobal("navigator", { vibrate });
    const { haptic } = await freshHaptic();
    haptic("light");
    expect(vibrate).toHaveBeenCalled();
  });

  it("respects the haptic setting", async () => {
    vi.stubGlobal("navigator", { vibrate });
    localStorage.setItem(
      "finsight:settings",
      JSON.stringify({
        theme: "system",
        reduceMotion: false,
        hideBalancesByDefault: false,
        maskValues: false,
        currency: "INR",
        aiEnabled: true,
        soundEffects: true,
        notificationSounds: true,
        haptic: false,
        notifications: {},
      })
    );
    const { haptic } = await freshHaptic();
    haptic("light");
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("skips on prefers-reduced-motion", async () => {
    vi.stubGlobal("navigator", { vibrate });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    const { haptic } = await freshHaptic();
    haptic("light");
    expect(vibrate).not.toHaveBeenCalled();
  });
});
