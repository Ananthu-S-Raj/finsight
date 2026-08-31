"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Icon, { Logo, type IconName } from "@/components/ui/Icons";
import { haptic } from "@/lib/haptics";
import { useMediaQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseClient";
import type { Whoami } from "@/lib/admin/client";

type AdminNavItem = {
  href: string;
  label: string;
  icon: IconName;
  permission?: string;
};

const ADMIN_NAV: AdminNavItem[] = [
  // Dashboard is the reporting surface (/overview requires REPORT_VIEW
  // server-side), so hide the nav item for admins without it.
  { href: "/admin/dashboard", label: "Dashboard", icon: "chart", permission: "REPORT_VIEW" },
  { href: "/admin/users", label: "Users", icon: "profile", permission: "USER_VIEW" },
  { href: "/admin/roles", label: "Roles", icon: "shield", permission: "ROLE_MANAGE" },
  { href: "/admin/transactions", label: "Transactions", icon: "transactions", permission: "TRANSACTION_VIEW" },
  { href: "/admin/categories", label: "Categories", icon: "tag", permission: "CATEGORY_MANAGE" },
  { href: "/admin/notifications", label: "Notifications", icon: "bell", permission: "NOTIFICATION_MANAGE" },
  { href: "/admin/push", label: "Push Devices", icon: "phone", permission: "USER_VIEW" },
  { href: "/admin/bug-reports", label: "Bug Reports", icon: "alert", permission: "BUG_REPORT_MANAGE" },
  { href: "/admin/audit", label: "Audit Log", icon: "lock", permission: "AUDIT_LOG_VIEW" },
  { href: "/admin/settings", label: "Settings", icon: "settings", permission: "SYSTEM_SETTINGS" },
  { href: "/admin/system", label: "System", icon: "globe", permission: "SYSTEM_SETTINGS" },
];

export default function AdminShell({
  whoami,
  children,
}: {
  whoami: Whoami;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isMobile = useMediaQuery("(max-width: 1023px)");
  const [menuOpen, setMenuOpen] = useState(false);
  const hasPermission = (p?: string) => !p || whoami.permissions.includes(p);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  async function logout() {
    haptic("toggle");
    await supabase.auth.signOut();
    router.push("/login");
  }

  const nav = (
    <nav className="flex-1 overflow-y-auto scroll-slim px-3 space-y-0.5 pb-3" aria-label="Admin">
      {ADMIN_NAV.filter((item) => hasPermission(item.permission)).map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            title={item.label}
            className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
              active ? "bg-tint-hi text-snow shadow-[0_0_0_1px_var(--line)]" : "text-slate hover:text-snow hover:bg-tint"
            }`}
          >
            <span
              className={`absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full transition-opacity duration-200 ${active ? "opacity-100" : "opacity-0"}`}
              style={{ background: "linear-gradient(180deg,#10b981,#6366f1)" }}
            />
            <Icon name={item.icon} size={18} className={active ? "text-accent" : ""} />
            <span className="flex-1 whitespace-nowrap">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-dvh">
      {/* ===== Desktop sidebar ===== */}
      {isDesktop && (
        <aside
          className="fixed left-4 top-4 bottom-4 z-50 hidden lg:flex flex-col rounded-3xl glass overflow-hidden"
          style={{ width: 248 }}
          aria-label="Admin console"
        >
          <div className="flex items-center gap-3 px-4 h-[72px] shrink-0 border-b border-line">
            <Link href="/admin/dashboard" className="flex items-center gap-3 shrink-0">
              <span className="text-accent inline-flex">
                <Logo size={28} />
              </span>
              <span className="text-base font-bold tracking-tight text-snow whitespace-nowrap">
                Admin <span className="text-accent">Console</span>
              </span>
            </Link>
          </div>
          {nav}
          <div className="p-3 border-t border-line shrink-0 space-y-2">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold text-slate hover:text-snow hover:bg-tint transition-colors"
            >
              <Icon name="home" size={16} />
              Back to FinSight
            </Link>
            <div className="flex items-center gap-3 rounded-2xl neo-inset p-2.5">
              <span
                className="h-9 w-9 rounded-xl shrink-0 inline-flex items-center justify-center text-sm font-bold text-[#04140d]"
                style={{ background: "linear-gradient(135deg,#10b981,#6366f1)" }}
              >
                {(whoami.email?.[0] ?? "A").toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-snow truncate">{whoami.email}</p>
                <p className="text-[13px] text-accent truncate">Administrator</p>
              </div>
              <button
                onClick={logout}
                aria-label="Log out"
                title="Log out"
                className="text-slate hover:text-danger transition-colors"
              >
                <Icon name="logOut" size={17} />
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* ===== Content ===== */}
      <main className="lg:pl-[280px] min-h-dvh">
        {isMobile && (
          <header className="sticky top-0 z-40 px-4 pt-3 pb-2 flex items-center gap-3 safe-top"
            style={{ background: "linear-gradient(180deg, rgba(11,15,20,0.85), rgba(11,15,20,0))", backdropFilter: "blur(12px)" }}>
            <button
              onClick={() => {
                haptic("light");
                setMenuOpen((o) => !o);
              }}
              className="neo h-11 w-11 rounded-xl inline-flex items-center justify-center text-slate hover:text-snow"
              aria-label="Open admin menu"
              aria-expanded={menuOpen}
            >
              <Icon name="menu" size={20} />
            </button>
            <span className="font-bold tracking-tight text-snow">
              Admin <span className="text-accent">Console</span>
            </span>
          </header>
        )}

        {isMobile && menuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
            <div className="absolute left-0 top-0 bottom-0 w-[280px] glass-elevated flex flex-col p-3 animate-fade-up">
              <div className="flex items-center gap-3 px-2 h-14 shrink-0">
                <span className="text-accent inline-flex">
                  <Logo size={24} />
                </span>
                <span className="font-bold tracking-tight text-snow">
                  Admin <span className="text-accent">Console</span>
                </span>
              </div>
              {nav}
              <Link
                href="/dashboard"
                className="flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold text-slate hover:text-snow hover:bg-tint transition-colors"
              >
                <Icon name="home" size={16} />
                Back to FinSight
              </Link>
              <button
                onClick={logout}
                className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold text-slate hover:text-danger hover:bg-tint transition-colors"
              >
                <Icon name="logOut" size={16} />
                Log out
              </button>
            </div>
          </div>
        )}

        <div className="px-4 sm:px-6 lg:px-8 pb-24 lg:pb-12 pt-4 lg:pt-8">{children}</div>
      </main>
    </div>
  );
}
