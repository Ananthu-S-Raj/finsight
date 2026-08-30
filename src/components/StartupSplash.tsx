"use client";

import { useEffect, useState } from "react";
import { Logo } from "./ui/Icons";

/**
 * Android-style launch splash. Rendered by the root layout, so its markup
 * ships with the very first server HTML and covers the viewport before any
 * page content (dashboard or login) can flash underneath. It lives outside
 * the routed tree, so client-side navigations never remount it.
 *
 * A sessionStorage guard ensures it plays only once per tab session: on a
 * genuine cold start (fresh tab / browser launch) it shows, then a flag is set
 * so any subsequent full page load in the same tab (plain <a> navigation, the
 * PWA auto-update reload, etc.) does NOT replay the startup splash.
 *
 * Hides after a short minimum display time (so the logo is actually seen),
 * fades out via CSS (the global reduced-motion rules collapse the fade to
 * an instant hide), and carries a hard cap so it can never stick around
 * indefinitely — even if hydration or timers misbehave.
 */

const MIN_DISPLAY_MS = 700;
const FADE_MS = 300;
const HARD_CAP_MS = 4000;

// The splash should only play once per browser tab session (sessionStorage
// survives client-side navigation and reloads within a tab). Without this, any
// full page load — e.g. a plain <a> navigation or the PWA update reload —
// remounts the root layout and replays the full startup splash on every
// navigation. sessionStorage guarantees it appears only on a genuine cold
// start (fresh tab / browser launch) and never on routine in-app navigation.
const SESSION_KEY = "finsight:startup-splash-shown";

function hasShownInSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markShownInSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // storage unavailable
  }
}

type Phase = "visible" | "fading" | "gone";

export default function StartupSplash() {
  const [phase, setPhase] = useState<Phase>(() =>
    hasShownInSession() ? "gone" : "visible"
  );

  useEffect(() => {
    markShownInSession();
  }, []);

  useEffect(() => {
    if (phase === "gone") return;
    let fadeTimer: number | undefined;
    let capTimer: number | undefined;
    // Start counting from the first painted frame.
    const raf = requestAnimationFrame(() => {
      fadeTimer = window.setTimeout(() => setPhase("fading"), MIN_DISPLAY_MS);
      capTimer = window.setTimeout(() => setPhase("gone"), HARD_CAP_MS);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (fadeTimer !== undefined) window.clearTimeout(fadeTimer);
      if (capTimer !== undefined) window.clearTimeout(capTimer);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "fading") return;
    const t = window.setTimeout(() => setPhase("gone"), FADE_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  if (phase === "gone") return null;

  return (
    <div
      data-testid="startup-splash"
      role="presentation"
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-5"
      style={{
        // Matches manifest.json's background_color for a seamless launch.
        background: "#0B0F14",
        opacity: phase === "fading" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: phase === "fading" ? "none" : "auto",
      }}
    >
      <span className="glass rounded-3xl p-6 inline-flex splash-logo">
        <Logo size={56} />
      </span>
      <p className="text-sm uppercase tracking-[0.35em] text-slate">FinSight</p>
    </div>
  );
}
