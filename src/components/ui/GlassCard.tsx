"use client";

import type { HTMLAttributes, ReactNode } from "react";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  hover?: boolean;
  tone?: "default" | "soft" | "elevated";
}

export default function GlassCard({
  children,
  hover = false,
  tone = "default",
  className = "",
  ...rest
}: GlassCardProps) {
  const base =
    tone === "soft"
      ? "glass-soft"
      : tone === "elevated"
        ? "glass-elevated"
        : "glass";
  return (
    <div
      className={`${base} rounded-2xl ${hover ? "glass-hover" : ""} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
