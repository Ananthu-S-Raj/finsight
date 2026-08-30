"use client";

import { useEffect, useState } from "react";
import { Logo } from "./ui/Icons";

/**
 * Android-style launch splash. Rendered by the root layout and lives outside
 * the routed tree, so client-side navigations (Home -> Analytics -> Budgets)
 * never remount it — the splash simply cannot replay on a route change.
 *
 * The component is deliberately SSR-empty: it renders no server HTML. Only
 * after hydration does it decide whether this tab session has already seen the
 * splash.
 *
 *   - Genuine cold start (fresh tab / browser launch): sessionStorage has no
 *     flag, so the splash plays once and the flag is set.
 *   - Any later full page load in the same tab (plain <a> navigation, manual
 *     reload, the PWA auto-update reload, etc.): the flag is present, so the
 *     splash never appears again.
 *   - New tab: sessionStorage is per-tab, so a brand-new session sees it again
 *     on cold start.
 *
 * Because the decision happens on the client, the server never bakes the splash
 * into HTML for a returning user — there is no hydration mismatch and no logo
 * "flash" on reload before the JavaScript decides it shouldn't be there.
 *
 * Hides after a short minimum display time (so the logo is actually seen),
 * fades out via CSS (the global reduced-motion rules collapse the fade to
 * an instant hide), and carries a hard cap so it can never stick around
 * indefinitely — even if hydration or timers misbehave.
 */

const MIN_DISPLAY_MS = 700;
const FADE_MS = 300;
const HARD_CAP_MS = 4000;

const SESSION_KEY = "finsight:startup-splash-shown";

function hasShownInSession(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      sessionStorage.getItem(SESSION_KEY) === "1"
    );
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

type Phase = "hidden" | "visible" | "fading" | "gone";

export default function StartupSplash() {
  // "hidden" is the SSR-safe state: no markup is emitted until the client has
  // hydrated and decided the splash is actually owed to this tab session.
  const [phase, setPhase] = useState<Phase>("hidden");

  useEffect(() => {
    if (hasShownInSession()) {
      setPhase("gone");
      return;
    }
    markShownInSession();
    setPhase("visible");
  }, []);

  useEffect(() => {
    if (phase === "hidden" || phase === "gone") return;
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

  if (phase === "hidden" || phase === "gone") return null;

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