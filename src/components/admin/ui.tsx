"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import GlassCard from "@/components/ui/GlassCard";
import Icon, { type IconName } from "@/components/ui/Icons";

const STATUS_COLORS: Record<string, string> = {
  active: "#10b981",
  disabled: "#f59e0b",
  suspended: "#ef4444",
  draft: "#94a3b8",
  sending: "#6366f1",
  sent: "#10b981",
  failed: "#ef4444",
  cancelled: "#94a3b8",
  admin: "#6366f1",
  user: "#10b981",
  success: "#10b981",
  denied: "#ef4444",
  error: "#ef4444",
};

export function StatusBadge({ value }: { value: string }) {
  const color = STATUS_COLORS[value] ?? "#94a3b8";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold capitalize"
      style={{ background: `${color}1a`, color, boxShadow: `inset 0 0 0 1px ${color}33` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {value}
    </span>
  );
}

export function StatCard({
  label,
  value,
  icon,
  color = "#6366f1",
  hint,
}: {
  label: string;
  value: ReactNode;
  icon: IconName;
  color?: string;
  hint?: string;
}) {
  return (
    <GlassCard className="p-4" hover>
      <span
        className="h-9 w-9 rounded-xl inline-flex items-center justify-center"
        style={{ background: `${color}1a`, color }}
      >
        <Icon name={icon} size={17} />
      </span>
      <p className="text-2xl font-bold text-snow tabular mt-3">{value}</p>
      <p className="text-[13px] text-slate mt-0.5">{label}</p>
      {hint && <p className="text-[13px] text-muted mt-0.5">{hint}</p>}
    </GlassCard>
  );
}

export function SectionCard({
  title,
  icon,
  actions,
  children,
  className = "",
}: {
  title?: string;
  icon?: IconName;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <GlassCard className={`overflow-hidden ${className}`}>
      {(title || actions) && (
        <div className="px-5 pt-4 pb-1 flex items-center gap-2">
          {icon && <Icon name={icon} size={15} className="text-accent" />}
          {title && <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate">{title}</h2>}
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </div>
      )}
      {children}
    </GlassCard>
  );
}

export function EmptyState({ icon = "info", title, hint }: { icon?: IconName; title: string; hint?: string }) {
  return (
    <div className="py-10 text-center animate-fade-up">
      <span className="inline-flex h-12 w-12 rounded-2xl glass items-center justify-center text-slate mb-3">
        <Icon name={icon} size={22} />
      </span>
      <p className="text-sm font-semibold text-snow">{title}</p>
      {hint && <p className="text-[13px] text-slate mt-1">{hint}</p>}
    </div>
  );
}

export function LoadingRow() {
  return (
    <div className="px-5 py-4 space-y-2">
      <div className="h-4 w-1/2 rounded-full bg-tint animate-pulse" />
      <div className="h-3 w-1/3 rounded-full bg-tint animate-pulse" />
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [inner, setInner] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(inner), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [inner, onChange]);

  return (
    <div className={`relative ${className}`}>
      <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate" />
      <input
        type="search"
        value={inner}
        onChange={(e) => setInner(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="field pl-9"
      />
    </div>
  );
}

export function Pagination({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  if (pages <= 1) {
    return <p className="text-[13px] text-slate text-center py-3">{total} result{total === 1 ? "" : "s"}</p>;
  }
  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-line">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className="btn btn-ghost text-[13px]"
      >
        <Icon name="chevronLeft" size={14} /> Prev
      </button>
      <p className="text-[13px] text-slate">
        Page {page} of {pages} · {total} results
      </p>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page >= pages}
        className="btn btn-ghost text-[13px]"
      >
        Next <Icon name="chevronRight" size={14} />
      </button>
    </div>
  );
}

export function PermissionGate({
  permission,
  permissions,
  children,
  fallback = null,
}: {
  permission: string;
  permissions: string[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return permissions.includes(permission) ? <>{children}</> : <>{fallback}</>;
}
