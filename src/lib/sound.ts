import { readSettings } from "./settingsCore";

export type SoundKind =
  | "success"
  | "income"
  | "transfer"
  | "budgetWarning"
  | "notification";

/**
 * FinSight sound feedback.
 *
 * - Zero audio files: every sound is synthesized with WebAudio, so nothing is
 *   downloaded and the payload stays tiny.
 * - Autoplay policies are respected: the AudioContext is created lazily on the
 *   first user gesture (any tap initializes it) and resumed on visibility
 *   change. If playback is ever blocked we fail silently — the app keeps
 *   working normally.
 * - Sound is disabled until the user has interacted with the page at least
 *   once, which is both policy-safe and non-annoying.
 */

let ctx: AudioContext | null = null;
let unlocked = false;
let lastPlay: number | null = null;

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") {
    try {
      ctx.resume();
    } catch {
      // ignore — still try to play below; browsers may gate it
    }
  }
  return ctx;
}

/** Call from a user gesture to unlock audio for the session. */
export function unlockAudio() {
  const c = ensureContext();
  if (c) {
    unlocked = true;
    try {
      c.resume();
    } catch {
      // ignore
    }
  }
}

/** Resumes the audio context (e.g. when the app returns to the foreground). */
export function resumeAudio() {
  if (ctx && ctx.state === "suspended") {
    try {
      ctx.resume();
    } catch {
      // ignore
    }
  }
}

function tone(
  c: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  volume: number,
  type: OscillatorType = "sine"
) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.05);
}

const SOUNDS: Record<SoundKind, (c: AudioContext, t0: number) => void> = {
  // Soft ascending two-note "ding" — money in.
  success: (c, t0) => {
    tone(c, 660, t0, 0.14, 0.16);
    tone(c, 990, t0 + 0.07, 0.18, 0.12);
  },
  // Slightly brighter variant of success for income.
  income: (c, t0) => {
    tone(c, 523.25, t0, 0.13, 0.14);
    tone(c, 783.99, t0 + 0.06, 0.2, 0.13);
    tone(c, 1046.5, t0 + 0.12, 0.22, 0.1);
  },
  // Short gliding whoosh — money moving.
  transfer: (c, t0) => {
    tone(c, 520, t0, 0.12, 0.11);
    tone(c, 390, t0 + 0.05, 0.14, 0.1);
  },
  // Two-tone "warn" — gentle, never harsh.
  budgetWarning: (c, t0) => {
    tone(c, 440, t0, 0.15, 0.12, "triangle");
    tone(c, 440, t0 + 0.16, 0.15, 0.12, "triangle");
  },
  // Notification "pop".
  notification: (c, t0) => {
    tone(c, 880, t0, 0.09, 0.09);
    tone(c, 1320, t0 + 0.06, 0.11, 0.07);
  },
};

export function isSoundSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    )
  );
}

/**
 * Plays a feedback sound. Gates on the user's sound settings and browser
 * autoplay policy; never throws.
 */
export function playSound(kind: SoundKind) {
  if (typeof window === "undefined") return;
  if (!unlocked) return;

  const settings = readSettings();
  const enabled = kind === "notification"
    ? settings.notificationSounds
    : settings.soundEffects;
  if (!enabled) return;

  const c = ensureContext();
  if (!c || c.state !== "running") return;

  // Debounce: skip if a sound played within the last 40ms (avoids overlapping
  // UI feedback chaining into a single noisy blip).
  const now = performance.now();
  if (lastPlay !== null && now - lastPlay < 40) return;
  lastPlay = now;

  try {
    const t0 = c.currentTime + 0.005;
    SOUNDS[kind](c, t0);
  } catch {
    // fail silently — the app must keep working without audio
  }
}

declare global {
  interface Window {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  }
}
