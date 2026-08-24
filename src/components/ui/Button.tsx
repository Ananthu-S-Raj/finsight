"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import Icon, { type IconName } from "./Icons";
import { haptic } from "@/lib/haptics";

type Variant = "primary" | "default" | "ghost" | "danger" | "neo";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  variant?: Variant;
  icon?: IconName;
  iconSize?: number;
  full?: boolean;
  vibrate?: boolean;
}

export default function Button({
  children,
  variant = "default",
  icon,
  iconSize,
  full,
  vibrate = false,
  className = "",
  onClick,
  ...rest
}: ButtonProps) {
  const variantClass =
    variant === "primary"
      ? "btn-primary"
      : variant === "ghost"
        ? "btn-ghost"
        : variant === "danger"
          ? "btn-danger"
          : variant === "neo"
            ? "neo"
            : "";

  return (
    <button
      className={`btn ${variantClass} ${full ? "w-full" : ""} ${className}`}
      onClick={(e) => {
        if (vibrate) haptic("toggle");
        onClick?.(e);
      }}
      {...rest}
    >
      {icon && <Icon name={icon} size={iconSize ?? 18} />}
      {children}
    </button>
  );
}
