"use client";

import { useEffect, useState } from "react";
import Icon from "./ui/Icons";

const PENDING_KEY = "finsight:sw:pending-version";
const ANNOUNCED_KEY = "finsight:sw:announced-version";
const NOTICE_MS = 6000;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable
  }
}

function removeStorage(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // storage unavailable
  }
}

/**
 * Auto-update PWA lifecycle.
 *
 * No permission is requested and no user action is required:
 *   1. A newly deployed service worker installs and immediately calls
 *      skipWaiting() (see sw.js), so it becomes active without asking.
 *   2. In `activate` it calls clients.claim() (taking control of every open
 *      window) and posts a `finsight-version` message.
 *   3. This component listens for `controllerchange` — the new worker now
 *      controls the page — and reloads the app ONCE to run the new code.
 *   4. Before reloading it stores a "pending version" marker in localStorage.
 *      The post-reload page consumes that marker and shows a small
 *      "FinSight has been updated" notice exactly once per version.
 *
 * Guards:
 *   - First install (no controlling worker at mount) is never treated as an
 *     update: no reload, no notice.
 *   - The reload is one-shot per page load; after the auto-update reload no
 *     controllerchange can fire again (control already switched), so there is
 *     no infinite reload loop.
 *   - A normal reload/navigation shows no notice because the pending marker is
 *     consumed the first time; the same version is never announced twice.
 *   - No Notification/Push usage here — this is separate from push
 *     notifications entirely.
 */
export default function UpdatePrompt() {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // First install: nothing controlled the page before, so this cannot be an
    // update. Skip all update handling (no reload, no notice).
    if (!navigator.serviceWorker.controller) return;

    // If a previous page announced its update by reloading, this load consumes
    // that marker and shows the notice once per version.
    const pending = readStorage(PENDING_KEY);
    if (pending) {
      removeStorage(PENDING_KEY);
      const announced = readStorage(ANNOUNCED_KEY);
      if (announced !== pending) {
        writeStorage(ANNOUNCED_KEY, pending);
        setNotice(pending);
      }
    }

    // Check for a newly deployed worker shortly after load (the browser also
    // checks on navigation/revisit, this just catches it sooner).
    navigator.serviceWorker.ready.then((reg) => reg.update()).catch(() => {});

    let latestVersion: string | null = null;
    let reloaded = false;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; version?: string } | null;
      if (!data || data.type !== "finsight-version" || !data.version) return;
      latestVersion = data.version;
    };

    const onControllerChange = () => {
      // A newer service worker now controls this page: the update is active.
      // Mark the pending version and reload once to run the new app code.
      if (reloaded) return;
      reloaded = true;
      writeStorage(PENDING_KEY, latestVersion ?? "latest");
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [notice]);

  if (!notice) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[90] p-4 safe-top" style={{ paddingTop: "calc(var(--safe-top) + 12px)" }}>
      <div className="glass-elevated max-w-md mx-auto rounded-2xl px-4 py-3 flex items-center gap-3 shadow-glass-lg animate-fade-up">
        <span className="h-9 w-9 rounded-xl glass inline-flex items-center justify-center text-accent shrink-0">
          <Icon name="refresh" size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-snow">FinSight has been updated.</p>
          <p className="text-[13px] text-slate leading-snug">You&apos;re on the latest version.</p>
        </div>
        <button
          onClick={() => setNotice(null)}
          aria-label="Dismiss update notice"
          className="neo h-10 w-10 rounded-xl inline-flex items-center justify-center text-slate hover:text-snow shrink-0"
        >
          <Icon name="close" size={15} />
        </button>
      </div>
    </div>
  );
}