import { describe, expect, it, beforeEach, vi } from "vitest";

class FakeOscillator {
  type = "sine";
  frequency = { setValueAtTime: vi.fn() };
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}
class FakeGain {
  gain = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
  connect = vi.fn();
}
class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  resume = vi.fn(() => {
    this.state = "running";
  });
  createOscillator = vi.fn(() => new FakeOscillator());
  createGain = vi.fn(() => new FakeGain());
}

function installWindow() {
  (globalThis as any).window = {
    AudioContext: FakeAudioContext,
    performance,
  };
}

function installSettings(patch: Record<string, unknown>) {
  const base = {
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
    },
    ...patch,
  };
  (globalThis as any).localStorage.setItem(
    "finsight:settings",
    JSON.stringify(base)
  );
}

async function freshSound() {
  vi.resetModules();
  return await import("@/lib/sound");
}

describe("sound", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "localStorage",
      new (class {
        private m = new Map<string, string>();
        getItem(k: string) {
          return this.m.get(k) ?? null;
        }
        setItem(k: string, v: string) {
          this.m.set(k, String(v));
        }
        removeItem(k: string) {
          this.m.delete(k);
        }
        clear() {
          this.m.clear();
        }
      })()
    );
    installWindow();
  });

  it("isSoundSupported detects WebAudio", async () => {
    const { isSoundSupported } = await freshSound();
    expect(isSoundSupported()).toBe(true);
  });

  it("does nothing before unlock (autoplay-safe)", async () => {
    const { playSound } = await freshSound();
    expect(() => playSound("success")).not.toThrow();
  });

  it("plays after unlock when enabled", async () => {
    const { unlockAudio, playSound } = await freshSound();
    installSettings({});
    unlockAudio();
    expect(() => playSound("success")).not.toThrow();
  });

  it("respects the sound-effects toggle", async () => {
    const { unlockAudio, playSound } = await freshSound();
    installSettings({ soundEffects: false });
    unlockAudio();
    expect(() => playSound("success")).not.toThrow();
  });

  it("treats notification sound as separate from effects", async () => {
    const { unlockAudio, playSound } = await freshSound();
    installSettings({ soundEffects: false, notificationSounds: true });
    unlockAudio();
    expect(() => playSound("notification")).not.toThrow();
  });

  it("skips notification sound when notificationSounds is off", async () => {
    const { unlockAudio, playSound } = await freshSound();
    installSettings({ soundEffects: true, notificationSounds: false });
    unlockAudio();
    expect(() => playSound("notification")).not.toThrow();
  });
});
