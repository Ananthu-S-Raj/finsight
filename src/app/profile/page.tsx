"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/ui/GlassCard";
import Button from "@/components/ui/Button";
import Icon, { type IconName } from "@/components/ui/Icons";
import { BalanceSkeleton } from "@/components/ui/Skeleton";
import { useRequireAuth } from "@/lib/useAuth";
import { usePageData } from "@/lib/usePageData";
import { inr } from "@/lib/format";
import { supabase } from "@/lib/supabaseClient";
import { haptic } from "@/lib/haptics";
import { useToast } from "@/components/ui/ToastProvider";

export default function ProfilePage() {
  const userId = useRequireAuth();
  const { profile, summary, loading } = usePageData(userId);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    document.title = "Profile · FinSight";
  }, []);

  async function logout() {
    haptic("toggle");
    await supabase.auth.signOut();
    toast.info("Signed out. See you soon.");
    router.push("/login");
  }

  const initials = (profile?.full_name ?? "F")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <AppShell userId={userId ?? ""} profile={profile ? { full_name: profile.full_name, email: profile.email, role: profile.role } : null}>
      <PageHeader title="Profile" subtitle="Your FinSight account." icon="profile" />

      {loading && !profile ? (
        <BalanceSkeleton />
      ) : (
        <div className="space-y-5 animate-fade-up">
          <GlassCard className="p-6 flex items-center gap-4" tone="elevated">
            <span
              className="h-16 w-16 rounded-2xl inline-flex items-center justify-center text-xl font-bold text-[#04140d] shrink-0"
              style={{ background: "linear-gradient(135deg,#10b981,#6366f1)", boxShadow: "0 8px 24px -8px rgba(16,185,129,0.6)" }}
            >
              {initials}
            </span>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-snow truncate">{profile!.full_name || "FinSight user"}</h2>
              <p className="text-sm text-slate truncate">{profile!.email}</p>
              <p className="text-[13px] uppercase tracking-widest text-accent mt-1.5 font-semibold">
                {profile!.role === "admin" ? "Admin" : "Member"}
              </p>
            </div>
            <Link href="/settings">
              <Button icon="settings" className="shrink-0">
                <span className="hidden sm:inline">Settings</span>
              </Button>
            </Link>
          </GlassCard>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {[
              { label: "Spendable balance", value: inr(profile!.salary_balance), icon: "wallet" as IconName, color: "#10b981" },
              { label: "Savings", value: inr(profile!.savings_balance), icon: "piggy" as IconName, color: "#eab308" },
              { label: "Monthly budget", value: inr(summary.budget), icon: "budgets" as IconName, color: "#f59e0b" },
              { label: "Spent this month", value: inr(summary.spent), icon: "expense" as IconName, color: "#ef4444" },
            ].map((s) => (
              <GlassCard key={s.label} className="p-4" hover>
                <span className="h-9 w-9 rounded-xl inline-flex items-center justify-center" style={{ background: `${s.color}1a`, color: s.color }}>
                  <Icon name={s.icon} size={17} />
                </span>
                <p className="text-lg font-bold text-snow tabular mt-3 truncate">{s.value}</p>
                <p className="text-[13px] text-slate mt-0.5">{s.label}</p>
              </GlassCard>
            ))}
          </div>

          <GlassCard className="divide-y divide-line" hover>
            {[
              { href: "/settings", label: "Settings & preferences", icon: "settings" as IconName, hint: "Appearance, notifications, privacy" },
              { href: "/notifications", label: "Notifications", icon: "bell" as IconName, hint: "In-app alerts and reminders" },
              { href: "/admin", label: "Admin tools", icon: "admin" as IconName, hint: "App health & diagnostics" },
            ].map((row) => (
              <Link key={row.href} href={row.href} className="flex items-center gap-3.5 px-5 py-4 row-press">
                <span className="h-10 w-10 rounded-xl glass inline-flex items-center justify-center text-slate shrink-0">
                  <Icon name={row.icon} size={18} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-snow">{row.label}</span>
                  <span className="block text-[13px] text-slate">{row.hint}</span>
                </span>
                <Icon name="chevronRight" size={16} className="text-slate shrink-0" />
              </Link>
            ))}
          </GlassCard>

          <Button variant="danger" icon="logOut" full onClick={logout}>
            Log out
          </Button>
        </div>
      )}
    </AppShell>
  );
}
