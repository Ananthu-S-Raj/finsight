"use client";

import { useEffect, useState } from "react";
import { inr, maskValue } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import Icon from "./Icons";

const HIDE_KEY = "finsight:hide-balances";

export function getDefaultHidden() {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useBalanceHidden() {
  const [hidden, setHidden] = useState(getDefaultHidden);

  useEffect(() => {
    try {
      if (hidden) localStorage.setItem(HIDE_KEY, "1");
      else localStorage.removeItem(HIDE_KEY);
    } catch {
      // storage unavailable
    }
  }, [hidden]);

  return [hidden, setHidden] as const;
}

/**
 * A number that blurs/hides when masked. The masked fallback never puts a real
 * amount in the accessibility tree, and aria-hidden keeps screen readers from
 * reading what the eye toggle is hiding.
 */
export function PrivateValue({
  value,
  hidden,
  className = "",
}: {
  value: number;
  hidden: boolean;
  className?: string;
}) {
  if (hidden) {
    return (
      <span
        className={`inline-block ${className}`}
        aria-hidden="true"
        style={{ filter: "blur(9px)", userSelect: "none" }}
        title=""
      >
        {maskValue(value)}
      </span>
    );
  }
  return <span className={`tabular ${className}`}>{inr(value)}</span>;
}

export function EyeToggle({
  hidden,
  onChange,
  className = "",
}: {
  hidden: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={hidden ? "Show balance" : "Hide balance"}
      aria-pressed={hidden}
      onClick={() => {
        haptic("toggle");
        onChange(!hidden);
      }}
      className={`neo h-11 w-11 rounded-xl inline-flex items-center justify-center text-slate hover:text-snow transition-colors ${className}`}
    >
      <Icon name={hidden ? "eye" : "eyeOff"} size={18} />
    </button>
  );
}
