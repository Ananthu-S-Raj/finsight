"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./ui/Icons";
import Button from "./ui/Button";

const PROMPTED_KEY = "finsight:sw:prompted-version";

function readPromptedVersion(): string | null {
  try {
    return localStorage.getItem(PROMPTED_KEY);
  } catch {
    return null;
  }
}

function writePromptedVersion(v: string) {
  try {
    localStorage.setItem(PROMPTED_KEY, v);
  } catch {
    // storage unavailable
  }
}

/**
 * In-app "new version available" banner.
 *
 * The service worker activates only once (the first time a given version runs
 * and takes control), then posts a `finsight-version` message to every window
 * (see sw.js `activate`). So a version message is always evidence of a newly
 * activated worker. When that happens while an OLDER worker already controls
 * the page, it is an in-place update and we show a Reload banner.
 *
 * - Reload only on user click (never auto-reload).
 * - No browser notification permission request; no system push used.
 * - Deduped per version (persisted in localStorage): we won't show the same
 *   version twice, including after a reload of the newly controlled page.
 * - A first-ever install (no prior controlling worker) is not treated as an
 *   update and never shows the banner.
 */
export default function UpdatePrompt() {
  const [version, setVersion] = useState<string | null>(null);
  const rejectedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (!navigator.serviceWorker.controller) return;

    let cancelled = false;
    // Set true once a newer worker reaches the `installed` state while an
    // older worker controls the page — that is the signal that the next
    // version message is an update, not a first install.
    let awaitingUpdate = false;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; version?: string } | null;
      if (!data || data.type !== "finsight-version" || !data.version) return;
      if (!awaitingUpdate) return; // no update observed — ignore
      if (rejectedRef.current) return;
      const already = readPromptedVersion();
      if (already === data.version) return; // already prompted for this version
      writePromptedVersion(data.version);
      setVersion(data.version);
    };

    const track = (worker: ServiceWorker | null) => {
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        // `installed` fires during install, strictly before `activate` (which
        // posts the version message), so awaitingUpdate is guaranteed set
        // before the message arrives.
        if (worker.state === "installed") awaitingUpdate = true;
      });
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    navigator.serviceWorker.ready
      .then((reg) => {
        if (cancelled) return;
        track(reg.installing);
        reg.addEventListener("updatefound", () => track(reg.installing));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  if (!version) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[90] p-4 safe-top" style={{ paddingTop: "calc(var(--safe-top) + 12px)" }}>
      <div className="glass-elevated max-w-md mx-auto rounded-2xl px-4 py-3 flex items-center gap-3 shadow-glass-lg animate-fade-up">
        <span className="h-9 w-9 rounded-xl glass inline-flex items-center justify-center text-accent shrink-0">
          <Icon name="refresh" size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-snow">A new version of FinSight is available.</p>
          <p className="text-[13px] text-slate leading-snug">Tap Reload to get the latest improvements.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => {
              rejectedRef.current = true;
              setVersion(null);
            }}
            aria-label="Dismiss update notice"
            className="neo h-10 w-10 rounded-xl inline-flex items-center justify-center text-slate hover:text-snow"
          >
            <Icon name="close" size={15} />
          </button>
          <Button variant="primary" icon="refresh" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    </div>
  );
}
