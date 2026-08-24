"use client";

import type { ReactNode } from "react";
import Icon, { type IconName } from "./ui/Icons";

export default function PageHeader({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 mb-6 animate-fade-up">
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <span className="hidden sm:inline-flex h-12 w-12 rounded-2xl glass items-center justify-center text-accent shrink-0">
            <Icon name={icon} size={22} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-snow truncate">
            {title}
          </h1>
          {subtitle && <p className="text-sm text-slate mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  );
}
