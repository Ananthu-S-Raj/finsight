import { HAPTIC, type HapticKind } from "./motion";
import { readSettings } from "./settingsCore";

let cached = false;
let supported = false;

function featureDetect(): boolean {
  if (cached) return supported;
  cached = true;
  supported =
    typeof navigator !== "undefined" && "vibrate" in navigator;
  return supported;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Subtle haptic feedback. Feature-detected, gated on the user's haptic
 * setting, never throws, and skips on reduced motion.
 */
export function haptic(kind: HapticKind) {
  if (!featureDetect()) return;
  if (prefersReducedMotion()) return;
  if (!readSettings().haptic) return;
  try {
    navigator.vibrate(HAPTIC[kind]);
  } catch {
    // unsupported — never break the experience
  }
}

export type { HapticKind } from "./motion";
