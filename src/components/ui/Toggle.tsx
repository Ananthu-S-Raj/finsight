"use client";

import { haptic } from "@/lib/haptics";

interface ToggleProps {
  on: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export default function Toggle({ on, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className="switch shrink-0 disabled:opacity-40"
      data-on={on}
      onClick={() => {
        haptic("toggle");
        onChange(!on);
      }}
    />
  );
}
