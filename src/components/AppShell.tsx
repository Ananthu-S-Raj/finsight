"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Icon, { Logo, type IconName } from "./ui/Icons";
import FloatingActionButton from "./FloatingActionButton";
import QuickAddSheet from "./QuickAddSheet";
import { useQuickAdd, useQuickAddState } from "./QuickAddContext";
import OfflineIndicator from "./OfflineIndicator";
import { useMediaQuery } from "@/lib/hooks";
import { useNotifications } from "@/lib/notifications";
import { firstName } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { supabase } from "@/lib/supabaseClient";
import { useMaintenanceStatus } from "@/lib/admin/useAdminData";
import { useRecurringEngine } from "@/lib/useRecurringEngine";
import { useBillEngine } from "@/lib/useBillEngine";
import { useGoalEngine } from "@/lib/useGoalEngine";

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
};

export const SIDEBAR_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "home" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/bills", label: "Bills", icon: "creditCard" },
  { href: "/transactions", label: "Transactions", icon: "transactions" },
  { href: "/recurring", label: "Recurring", icon: "recurring" },
  { href: "/analytics", label: "Analytics", icon: "analytics" },
  { href: "/budgets", label: "Budgets", icon: "budgets" },
  { href: "/savings", label: "Savings", icon: "piggy" },
  { href: "/goals", label: "Goals", icon: "target" },
  { href: "/cards", label: "Credit Cards", icon: "card" },
  { href: "/lend", label: "Borrow & Lend", icon: "lend" },
  { href: "/insights", label: "AI Insights", icon: "sparkles" },
  { href: "/notifications", label: "Notifications", icon: "bell" },
  { href: "/profile", label: "Profile", icon: "profile" },
  { href: "/admin", label: "Admin", icon: "admin" },
];

export const BOTTOM_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/analytics", label: "Analytics", icon: "analytics" },
  { href: "/budgets", label: "Budgets", icon: "budgets" },
  { href: "/profile", label: "Profile", icon: "profile" },
];

const COLLAPSE_KEY = "finsight:nav-collapsed";

export default function AppShell({
  userId,
  profile,
  children,
}: {
  userId: string;
  profile: { full_name: string; email?: string; role?: string } | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isMobile = useMediaQuery("(max-width: 1023px)");
  const [collapsed, setCollapsed] = useState(false);
  const openQuickAdd = useQuickAdd();
  const { mode: quickMode, close: closeQuickAdd } = useQuickAddState();
  const { unread } = useNotifications();
  const pathRef = useRef(pathname);
  useRecurringEngine(userId);
  useBillEngine(userId);
  useGoalEngine(userId);

  // Role is read server-side too; this only decides which links are rendered.
  const [role, setRole] = useState<string | null>(profile?.role ?? null);
  const { maintenance, loaded: maintenanceLoaded } = useMaintenanceStatus();

  useEffect(() => {
    // Skip the query when the caller already provided the role (e.g.
    // usePageData fetches the full profile including role).
    if (role) return;
    if (!userId) return;
    let active = true;
    supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle()
      .then(
        ({ data }) => {
          if (active) setRole((data?.role as string) ?? "user");
        },
        () => {
          if (active) setRole("user");
        }
      );
    return () => {
      active = false;
    };
  }, [userId, role]);

  const isAdmin = role === "admin";
  const sidebarItems = SIDEBAR_ITEMS.filter((item) => item.href !== "/admin" || isAdmin);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // storage unavailable
    }
  }, []);

  useEffect(() => {
    // Keep localStorage in sync when the user collapses the sidebar.
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [collapsed]);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  async function logout() {
    haptic("toggle");
    await supabase.auth.signOut();
    router.push("/login");
  }

  const renderDesktopSidebar = isDesktop;

  // Maintenance gate: regular users are shown a maintenance screen while it is
  // active. Administrators always keep access (with a warning banner).
  const blockedByMaintenance = maintenanceLoaded && maintenance && !isAdmin;

  if (blockedByMaintenance) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <span className="inline-flex h-16 w-16 rounded-3xl glass items-center justify-center text-accent mb-5">
            <Logo size={32} />
          </span>
          <h1 className="text-2xl font-bold text-snow">Under maintenance</h1>
          <p className="text-sm text-slate mt-2 leading-relaxed">
            FinSight is being upgraded. Please check back shortly — your data is safe.
          </p>
          <p className="text-[13px] text-muted mt-6">
            Planned maintenance. We apologize for the interruption.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <OfflineIndicator />

      {maintenance && isAdmin && (
        <div className="sticky top-0 z-[45] px-4 py-2 text-center text-[13px] font-semibold text-[#5b3a00]" style={{ background: "#f59e0b22", boxShadow: "inset 0 0 0 1px #f59e0b55" }}>
          Maintenance mode is ON — only administrators can use FinSight right now.
        </div>
      )}

      {/* ================= Desktop sidebar ================= */}
      {renderDesktopSidebar && (
        <aside
          className="fixed left-4 top-4 bottom-4 z-50 hidden lg:flex flex-col rounded-3xl glass transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden"
          style={{ width: collapsed ? 80 : 248 }}
          aria-label="Primary"
        >
          <div className="flex items-center gap-3 px-4 h-[72px] shrink-0">
            <Link href="/dashboard" className="flex items-center gap-3 shrink-0" aria-label="FinSight dashboard">
              <span className="text-accent inline-flex">
                <Logo size={30} />
              </span>
              {!collapsed && (
                <span className="text-lg font-bold tracking-tight text-snow whitespace-nowrap">
                  Fin<span className="text-accent">Sight</span>
                </span>
              )}
            </Link>
            <button
              onClick={() => {
                haptic("light");
                setCollapsed((c) => !c);
              }}
              className="ml-auto neo h-8 w-8 rounded-lg inline-flex items-center justify-center text-slate hover:text-snow shrink-0"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <Icon name="chevronLeft" size={15} style={{ transform: collapsed ? "rotate(180deg)" : "none", transition: "transform 200ms" }} />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto scroll-slim px-3 space-y-0.5 pb-3">
            {sidebarItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  title={item.label}
                  className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                    active
                      ? "bg-tint-hi text-snow shadow-[0_0_0_1px_var(--line)]"
                      : "text-slate hover:text-snow hover:bg-tint"
                  } ${collapsed ? "justify-center px-0" : ""}`}
                >
                  <span className={`absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full transition-opacity duration-200 ${active ? "opacity-100" : "opacity-0"}`} style={{ background: "linear-gradient(180deg,#10b981,#6366f1)" }} />
                  <Icon
                    name={item.icon}
                    size={19}
                    className={active ? "text-accent" : ""}
                  />
                  {!collapsed && (
                    <span className="flex-1 whitespace-nowrap">{item.label}</span>
                  )}
                  {!collapsed && item.href === "/notifications" && unread > 0 && (
                    <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full text-xs font-bold text-[#04140d]" style={{ background: "linear-gradient(135deg,#10b981,#34d399)" }}>
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="p-3 border-t border-line shrink-0">
            <div className={`flex items-center gap-3 rounded-2xl neo-inset p-2.5 ${collapsed ? "justify-center" : ""}`}>
              <span className="h-9 w-9 rounded-xl shrink-0 inline-flex items-center justify-center text-sm font-bold text-[#04140d]" style={{ background: "linear-gradient(135deg,#10b981,#6366f1)" }}>
                {(profile?.full_name?.[0] ?? "F").toUpperCase()}
              </span>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-snow truncate">{firstName(profile?.full_name ?? "You")}</p>
                  <p className="text-[13px] text-slate truncate">{profile?.email ?? "Signed in"}</p>
                </div>
              )}
              {!collapsed && (
                <button
                  onClick={logout}
                  aria-label="Log out"
                  title="Log out"
                  className="text-slate hover:text-danger transition-colors"
                >
                  <Icon name="logOut" size={17} />
                </button>
              )}
            </div>
          </div>
        </aside>
      )}

      {/* ================= Content ================= */}
      <main
        className={`transition-[padding-left] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] min-h-dvh ${
          isDesktop
            ? collapsed
              ? "lg:pl-[108px]"
              : "lg:pl-[280px]"
            : ""
        }`}
      >
        {/* Mobile top bar */}
        {isMobile && (
          <header className="sticky top-0 z-40 px-4 pt-3 pb-2 flex items-center justify-between safe-top" style={{ background: "linear-gradient(180deg, rgba(11,15,20,0.85), rgba(11,15,20,0))", backdropFilter: "blur(12px)" }}>
            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="text-accent inline-flex">
                <Logo size={26} />
              </span>
              <span className="font-bold tracking-tight text-snow">
                Fin<span className="text-accent">Sight</span>
              </span>
            </Link>
            <Link
              href="/notifications"
              className="relative neo h-11 w-11 rounded-xl inline-flex items-center justify-center text-slate hover:text-snow"
              aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
            >
              <Icon name="bell" size={20} />
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-1 rounded-full text-xs font-bold text-[#04140d]" style={{ background: "linear-gradient(135deg,#10b981,#34d399)", minWidth: 20, height: 20 }}>
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
          </header>
        )}

        <div className="px-4 sm:px-6 lg:px-8 pb-40 lg:pb-12 pt-2">{children}</div>      </main>

      {/* ================= Mobile bottom nav ================= */}
      {isMobile && (
        <nav
          className="fixed bottom-0 inset-x-0 z-50"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          aria-label="Primary"
        >
          <div className="mx-3 mb-3 rounded-3xl glass px-2 py-1.5 flex items-center justify-around shadow-glass-lg">
            {BOTTOM_NAV.map((item, idx) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-col items-center gap-1 rounded-2xl px-3 py-1.5 min-w-16 transition-all duration-200 ${
                    active ? "text-snow" : "text-slate"
                  }`}
                >
                  <span className={`relative h-6 flex items-center ${active ? "scale-110" : ""} transition-transform duration-200`}>
                    <Icon name={item.icon} size={22} className={active ? "text-accent" : ""} />
                    {item.href === "/notifications" && unread > 0 && (
                      <span className="absolute -top-1.5 -right-2 inline-flex items-center justify-center rounded-full text-xs font-bold text-[#04140d]" style={{ background: "#10b981", minWidth: 18, height: 18, padding: "0 3px" }}>
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                  </span>
                  <span className="text-[13px] font-semibold tracking-wide">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {/* ================= FAB ================= */}
      <FloatingActionButton onSelect={openQuickAdd} />
      <QuickAddSheet
        open={quickMode !== null}
        onClose={closeQuickAdd}
        userId={userId}
        initialMode={quickMode ?? "expense"}
      />
    </div>
  );
}
