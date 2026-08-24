"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./ui/Icons";
import Button from "./ui/Button";
import { Logo } from "./ui/Icons";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALLED_KEY = "finsight-installed";
const DISMISSED_KEY = "finsight-install-dismissed";
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_DISMISSED_KEY = "finsight-install-dismissed-session";

type PromptMode = "native" | "ios" | "instructions" | null;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
  if (window.matchMedia("(display-mode: minimal-ui)").matches) return true;
  return Boolean((window.navigator as unknown as { standalone?: boolean }).standalone);
}

function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const iOSDevice = /iPhone|iPad|iPod/.test(ua);
  const iPadOSDesktop = window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1;
  return iOSDevice || iPadOSDesktop;
}

function isSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg/i.test(ua);
}

function hasBeenInstalled(): boolean {
  try {
    return localStorage.getItem(INSTALLED_KEY) === "1";
  } catch {
    return false;
  }
}

function hasDismissedRecently(): boolean {
  try {
    const ts = Number(localStorage.getItem(DISMISSED_KEY));
    return Number.isFinite(ts) && Date.now() - ts < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function hasDismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberInstall() {
  try {
    localStorage.setItem(INSTALLED_KEY, "1");
  } catch {}
}

function rememberDismissal() {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    sessionStorage.setItem(SESSION_DISMISSED_KEY, "1");
  } catch {}
}

export default function InstallAppPrompt() {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [mode, setMode] = useState<PromptMode>(null);

  useEffect(() => {
    if (isStandalone() || hasBeenInstalled()) return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (hasDismissedThisSession() || hasDismissedRecently()) return;
      deferredPrompt.current = event as BeforeInstallPromptEvent;
      setMode("native");
    };

    const onAppInstalled = () => {
      rememberInstall();
      deferredPrompt.current = null;
      setMode(null);
    };

    const onVisibilityChange = () => {
      if (document.hidden && isStandalone()) {
        rememberInstall();
        setMode(null);
      }
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    document.addEventListener("visibilitychange", onVisibilityChange);

    const timeout = window.setTimeout(() => {
      if (mode === null && !hasDismissedThisSession() && !hasDismissedRecently()) {
        if (isIOS() || isSafari()) setMode("ios");
        else setMode("instructions");
      }
    }, 4000);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearTimeout(timeout);
    };
  }, [mode]);

  async function handleInstall() {
    const prompt = deferredPrompt.current;
    if (!prompt) {
      dismiss();
      return;
    }
    await prompt.prompt();
    const choice = await prompt.userChoice;
    deferredPrompt.current = null;
    if (choice.outcome === "accepted") {
      rememberInstall();
      setMode(null);
    } else {
      dismiss();
    }
  }

  function dismiss() {
    rememberDismissal();
    deferredPrompt.current = null;
    setMode(null);
  }

  if (!mode) return null;

  const title = "Install FinSight";
  const body =
    mode === "native"
      ? "Install FinSight on your device for a faster, app-like experience — works offline too."
      : mode === "ios"
        ? "Tap Share → Add to Home Screen to install FinSight on your device."
        : "Open your browser menu and choose “Install app” or “Add to Home Screen”.";

  return (
    <div className="fixed inset-x-0 bottom-0 z-[85] p-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}>
      <div className="glass-elevated max-w-md mx-auto rounded-3xl p-5 shadow-glass-lg animate-fade-up">
        <div className="flex items-start gap-4">
          <span className="text-accent inline-flex glass rounded-2xl p-3 shrink-0">
            <Logo size={26} />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-snow">{title}</h2>
            <p className="mt-1 text-sm text-slate leading-snug">{body}</p>
          </div>
          <button
            onClick={dismiss}
            aria-label="Close install prompt"
            className="neo h-11 w-11 rounded-xl inline-flex items-center justify-center text-slate hover:text-snow shrink-0"
          >
            <Icon name="close" size={15} />
          </button>
        </div>
        <div className="mt-4 flex gap-3">
          <Button onClick={handleInstall} variant="primary" icon="download" className="flex-1">
            {mode === "native" ? "Install" : "Got it"}
          </Button>
          <Button onClick={dismiss} className="flex-1">
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}
