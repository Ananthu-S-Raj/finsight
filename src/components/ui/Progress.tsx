"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "@/lib/hooks";

interface ProgressRingProps {
  value: number; // 0-100
  size?: number;
  stroke?: number;
  color?: "accent" | "indigo" | "warn" | "danger" | "gold";
  trackColor?: string;
  children?: React.ReactNode;
}

const RING_COLORS: Record<string, string> = {
  accent: "#10b981",
  indigo: "#6366f1",
  warn: "#f59e0b",
  danger: "#ef4444",
  gold: "#eab308",
};

export function ProgressRing({
  value,
  size = 120,
  stroke = 10,
  color = "accent",
  trackColor = "var(--tint-hi)",
  children,
}: ProgressRingProps) {
  const reduced = useReducedMotion();
  const pct = Math.max(0, Math.min(100, value));
  const [rendered, setRendered] = useState(reduced ? pct : 0);
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;

  useEffect(() => {
    if (reduced) {
      setRendered(pct);
      return;
    }
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setRendered(pct)));
    return () => cancelAnimationFrame(raf);
  }, [pct, reduced]);

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={RING_COLORS[color]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - rendered / 100)}
          style={{
            filter: `drop-shadow(0 0 8px ${RING_COLORS[color]}66)`,
            transition: reduced
              ? "none"
              : "stroke-dashoffset 0.9s cubic-bezier(0.16,1,0.3,1)",
          }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
