"use client";

import { useEffect, useRef, useState } from "react";
import Icon, { type IconName } from "./ui/Icons";
import { useMediaQuery } from "@/lib/hooks";
import { haptic } from "@/lib/haptics";
import type { AddMode } from "./QuickAddSheet";

const ACTIONS: { mode: AddMode; label: string; hint: string; icon: IconName; color: string }[] = [
  { mode: "expense", label: "Expense", hint: "Log a spend", icon: "expense", color: "#ef4444" },
  { mode: "income", label: "Income", hint: "Salary, savings, loan", icon: "income", color: "#10b981" },
  { mode: "transfer", label: "Transfer", hint: "Move to savings", icon: "transfer", color: "#6366f1" },
  { mode: "savings", label: "Savings", hint: "Add to savings", icon: "piggy", color: "#eab308" },
  { mode: "credit", label: "Credit Card", hint: "Log a card charge", icon: "creditCard", color: "#f59e0b" },
];

export default function FloatingActionButton({
  onSelect,
}: {
  onSelect: (mode: AddMode) => void;
}) {
  const [open, setOpen] = useState(false);
  // Match AppShell's desktop breakpoint so the FAB never overlaps the mobile
  // bottom nav on tablets.
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  function toggle() {
    haptic("fab");
    setOpen((o) => !o);
  }

  return (
    <>
      {/* Backdrop for the mobile sheet */}
      {open && !isDesktop && (
        <div
          className="fixed inset-0 z-[60] bg-scrim"
          style={{ backdropFilter: "blur(4px)" }}
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        ref={menuRef}
        className="fixed z-[70]"
        style={{
          right: 22,
          // On mobile the FAB floats above the bottom nav; on desktop it sits in
          // the corner.
          bottom: isDesktop
            ? "calc(var(--safe-bottom) + 24px)"
            : "calc(var(--safe-bottom) + 92px)",
        }}
      >
        {/* Desktop floating menu */}
        {open && isDesktop && (
          <div className="absolute right-0 bottom-[76px] w-64 rounded-2xl glass-elevated p-2 animate-scale-in origin-bottom-right shadow-glass-lg">
            <p className="px-3 pt-2 pb-1 text-[13px] uppercase tracking-widest text-slate font-semibold">
              Quick add
            </p>
            {ACTIONS.map((a, i) => (
              <button
                key={a.mode}
                onClick={() => {
                  setOpen(false);
                  onSelect(a.mode);
                }}
                className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 row-press hover:bg-tint"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <span
                  className="h-9 w-9 rounded-xl inline-flex items-center justify-center shrink-0"
                  style={{ background: `${a.color}1f`, color: a.color }}
                >
                  <Icon name={a.icon} size={17} />
                </span>
                <span className="text-left">
                  <span className="block text-sm font-semibold text-snow">{a.label}</span>
                  <span className="block text-[13px] text-slate">{a.hint}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Mobile action sheet */}
        {open && !isDesktop && (
          <div className="absolute right-0 bottom-[76px] w-72 rounded-2xl glass-elevated p-2 animate-scale-in origin-bottom-right shadow-glass-lg">
            <p className="px-3 pt-2 pb-1 text-[13px] uppercase tracking-widest text-slate font-semibold">
              Quick add
            </p>
            {ACTIONS.map((a) => (
              <button
                key={a.mode}
                onClick={() => {
                  setOpen(false);
                  onSelect(a.mode);
                }}
                className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 row-press hover:bg-tint"
              >
                <span
                  className="h-9 w-9 rounded-xl inline-flex items-center justify-center shrink-0"
                  style={{ background: `${a.color}1f`, color: a.color }}
                >
                  <Icon name={a.icon} size={17} />
                </span>
                <span className="text-left">
                  <span className="block text-sm font-semibold text-snow">{a.label}</span>
                  <span className="block text-[13px] text-slate">{a.hint}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* The FAB itself */}
        <button
          onClick={toggle}
          aria-label={open ? "Close quick add" : "Add money or expense"}
          aria-expanded={open}
          className="relative h-[60px] w-[60px] rounded-2xl inline-flex items-center justify-center text-[#04140d] shadow-glow-accent"
          style={{
            background: "linear-gradient(135deg,#12c987,#0da171)",
            transition: "transform 200ms cubic-bezier(0.16,1,0.3,1), border-radius 200ms",
          }}
        >
          <span
            className="absolute inset-0 rounded-2xl ring-1 ring-line"
            style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.35) inset" }}
          />
          <Icon
            name="plus"
            size={26}
            className="relative transition-transform duration-200"
            style={{ transform: open ? "rotate(45deg) scale(0.9)" : "rotate(0deg)" }}
          />
        </button>
      </div>
    </>
  );
}
