"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Icon, { type IconName } from "./Icons";
import { haptic } from "@/lib/haptics";

type ToastVariant = "success" | "error" | "info" | "warning";
type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
  actionLabel?: string;
  onAction?: () => void;
  duration: number;
};

interface ToastContextValue {
  toast: (
    message: string,
    opts?: {
      variant?: ToastVariant;
      actionLabel?: string;
      onAction?: () => void;
      duration?: number;
    }
  ) => void;
  success: (message: string, opts?: Partial<Toast>) => void;
  error: (message: string, opts?: Partial<Toast>) => void;
  info: (message: string, opts?: Partial<Toast>) => void;
  warning: (message: string, opts?: Partial<Toast>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastVariant, IconName> = {
  success: "check",
  error: "alert",
  info: "info",
  warning: "alert",
};

const COLORS: Record<ToastVariant, string> = {
  success: "#10b981",
  error: "#ef4444",
  info: "#6366f1",
  warning: "#f59e0b",
};

let idCounter = 0;

function ToastView({ t, onDone }: { t: Toast; onDone: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDone(t.id), t.duration);
    return () => window.clearTimeout(timer);
  }, [t.id, t.duration, onDone]);

  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const raf = requestAnimationFrame(() => {
      bar.style.transform = "scaleX(0)";
    });
    return () => cancelAnimationFrame(raf);
  }, [t.duration]);

  const color = COLORS[t.variant];

  return (
    <div className="glass-elevated rounded-2xl px-4 py-3 flex items-center gap-3 shadow-glass-lg animate-fade-up">
      <span
        className="h-9 w-9 rounded-xl inline-flex items-center justify-center shrink-0"
        style={{ background: `${color}22`, color }}
      >
        <Icon name={ICONS[t.variant]} size={18} />
      </span>
      <p className="flex-1 text-sm font-medium text-snow leading-snug">{t.message}</p>
      {t.actionLabel && (
        <button
          onClick={() => {
            t.onAction?.();
            onDone(t.id);
          }}
          className="text-sm font-semibold shrink-0"
          style={{ color }}
        >
          {t.actionLabel}
        </button>
      )}
      <span className="relative overflow-hidden rounded-full" style={{ width: 14, height: 3, background: "var(--tint-hi)" }}>
        <span
          ref={barRef}
          className="absolute inset-0 origin-left"
          style={{
            background: color,
            transform: "scaleX(1)",
            transition: `transform ${t.duration}ms linear`,
          }}
        />
      </span>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastContextValue["toast"]>(
    (message, opts) => {
      const id = ++idCounter;
      const item: Toast = {
        id,
        message,
        variant: opts?.variant ?? "success",
        duration: opts?.duration ?? 3200,
        actionLabel: opts?.actionLabel,
        onAction: opts?.onAction,
      };
      setToasts((prev) => [...prev, item].slice(-3));
    },
    []
  );

  const success = useCallback<ToastContextValue["success"]>(
    (m, o) => {
      haptic("success");
      toast(m, { variant: "success", ...o });
    },
    [toast]
  );

  const error = useCallback<ToastContextValue["error"]>(
    (m, o) => {
      haptic("warning");
      toast(m, { variant: "error", duration: 4200, ...o });
    },
    [toast]
  );

  const info = useCallback<ToastContextValue["info"]>(
    (m, o) => toast(m, { variant: "info", ...o }),
    [toast]
  );

  const warning = useCallback<ToastContextValue["warning"]>(
    (m, o) => toast(m, { variant: "warning", ...o }),
    [toast]
  );

  const value = useMemo<ToastContextValue>(
    () => ({ toast, success, error, info, warning }),
    [toast, success, error, info, warning]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed left-0 right-0 top-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none safe-top"
        style={{ top: "calc(var(--safe-top) + 12px)" }}>
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto w-full max-w-sm" role="status">
            <ToastView t={t} onDone={remove} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
