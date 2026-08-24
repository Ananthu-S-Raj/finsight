"use client";

import { useEffect, useState } from "react";
import Button from "./ui/Button";
import { firstName } from "@/lib/format";
import { birthdayStorageKey, isBirthdayToday } from "@/lib/birthday";

/**
 * Birthday greeting shown once per day on the dashboard (the app's startup
 * destination) when the signed-in user's birthday is today. Renders nothing
 * for users without a date of birth, when it isn't their birthday, or after
 * the greeting was already dismissed this session.
 */
export default function BirthdayGreeting({
  name,
  dateOfBirth,
}: {
  name?: string | null;
  dateOfBirth?: string | null;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!dateOfBirth || !isBirthdayToday(dateOfBirth)) return;
    let shown = false;
    try {
      shown = sessionStorage.getItem(birthdayStorageKey()) === "1";
    } catch {
      shown = false;
    }
    if (!shown) setShow(true);
  }, [dateOfBirth]);

  function dismiss() {
    try {
      sessionStorage.setItem(birthdayStorageKey(), "1");
    } catch {}
    setShow(false);
  }

  if (!show) return null;

  return (
    <div
      role="status"
      data-testid="birthday-greeting"
      className="fixed inset-x-0 z-[90] p-4 safe-top"
      style={{ top: "calc(var(--safe-top) + 12px)" }}
    >
      <div className="glass-elevated max-w-md mx-auto rounded-3xl p-6 shadow-glass-lg animate-fade-up text-center">
        <span className="text-4xl" aria-hidden="true">
          🎉
        </span>
        <h2 className="mt-2 text-lg font-bold text-snow">
          Happy Birthday{name ? `, ${firstName(name)}` : ""}!
        </h2>
        <p className="mt-1 text-sm text-slate leading-snug">
          Wishing you an amazing year ahead! ❤️
        </p>
        <Button onClick={dismiss} variant="primary" className="mt-4 w-full">
          Thank you
        </Button>
      </div>
    </div>
  );
}
