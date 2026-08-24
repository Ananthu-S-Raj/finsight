"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icons";

/**
 * Destructive-action confirmation. Requires either a free-text confirmation
 * (when `confirmText` is provided) or a double-click of the confirm button.
 * Never a single click.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  confirmText,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  confirmText?: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [typed, setTyped] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTyped("");
      setArmed(false);
      setBusy(false);
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const textMatches = !confirmText || typed === confirmText;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-scrim backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-md glass-elevated rounded-3xl p-6 animate-fade-up">
        <div className="flex items-start gap-3">
          <span className="h-10 w-10 rounded-2xl inline-flex items-center justify-center shrink-0 text-danger" style={{ background: "#ef44441a" }}>
            <Icon name="alert" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-snow">{title}</h3>
            {message && <div className="text-sm text-slate mt-1.5 leading-relaxed">{message}</div>}
          </div>
        </div>

        {confirmText && (
          <div className="mt-5">
            <label className="text-[13px] uppercase tracking-wider text-slate font-medium block mb-1.5">
              Type <span className="font-mono text-snow">{confirmText}</span> to continue
            </label>
            <input
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="field"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}

        {children}

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            // The arm-then-fire guard below provides the double-click
            // protection, so the button must stay clickable to receive the
            // first (arming) click when no typed confirmation is required.
            disabled={!textMatches || busy}
            onClick={async () => {
              if (!confirmText && !armed) {
                setArmed(true);
                return;
              }
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
                onClose();
              }
            }}
          >
            {confirmText ? confirmLabel : armed ? `${confirmLabel} — tap again` : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
