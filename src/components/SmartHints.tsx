"use client";

import { useEffect, useState } from "react";
import Icon, { type IconName } from "./ui/Icons";

export function SmartHint({
  icon,
  tone,
  children,
}: {
  icon: IconName;
  tone: "accent" | "warn" | "danger" | "indigo";
  children: React.ReactNode;
}) {
  const color =
    tone === "accent"
      ? "#10b981"
      : tone === "warn"
        ? "#f59e0b"
        : tone === "danger"
          ? "#ef4444"
          : "#6366f1";

  return (
    <div
      className="glass-soft rounded-2xl px-4 py-3 flex items-start gap-3 animate-fade-up"
      style={{ borderColor: `${color}33` }}
    >
      <span
        className="h-9 w-9 rounded-xl inline-flex items-center justify-center shrink-0"
        style={{ background: `${color}1a`, color }}
      >
        <Icon name={icon} size={17} />
      </span>
      <p className="text-sm text-snow font-medium leading-snug">{children}</p>
    </div>
  );
}

/** "₹X remaining" / "₹X over budget" hint with animated progress. */
export function BudgetHint({
  spent,
  budget,
}: {
  spent: number;
  budget: number;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 400);
    return () => window.clearTimeout(t);
  }, []);

  const pct = budget > 0 ? (spent / budget) * 100 : 0;

  if (budget <= 0) {
    return (
      <SmartHint icon="budgets" tone="indigo">
        Set a monthly budget to see how your spending is tracking.
      </SmartHint>
    );
  }

  if (pct >= 100) {
    const over = spent - budget;
    return (
      <div
        className="glass-soft rounded-2xl px-4 py-3 flex items-center gap-3 animate-fade-up"
        style={{ borderColor: "#ef444444" }}
      >
        <span className="h-9 w-9 rounded-xl inline-flex items-center justify-center shrink-0" style={{ background: "#ef44441a", color: "#ef4444" }}>
          <Icon name="alert" size={17} />
        </span>
        <div className="flex-1">
          <p className="text-sm text-snow font-medium">₹{Math.round(over)} over budget</p>
          <div className="progress-track mt-2" style={{ height: 6 }}>
            <div
              className="progress-fill"
              style={{
                width: "100%",
                transform: ready ? "scaleX(1)" : "scaleX(0)",
                background: "linear-gradient(90deg,#ef4444,#f87171)",
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-soft rounded-2xl px-4 py-3 flex items-center gap-3 animate-fade-up" style={{ borderColor: "#10b98133" }}>
      <span className="h-9 w-9 rounded-xl inline-flex items-center justify-center shrink-0" style={{ background: "#10b9811a", color: "#10b981" }}>
        <Icon name="trendUp" size={17} />
      </span>
      <div className="flex-1">
        <p className="text-sm text-snow font-medium">
          ₹{Math.round(budget - spent)} remaining this month
        </p>
        <div className="progress-track mt-2" style={{ height: 6 }}>
          <div
            className="progress-fill"
            style={{
              width: "100%",
              transform: ready ? `scaleX(${Math.min(1, pct / 100)})` : "scaleX(0)",
              background: pct > 80 ? "linear-gradient(90deg,#f59e0b,#fbbf24)" : "linear-gradient(90deg,#10b981,#34d399)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
