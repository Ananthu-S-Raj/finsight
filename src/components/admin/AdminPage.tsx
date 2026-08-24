"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AdminShell from "./AdminShell";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/ui/GlassCard";
import Icon, { type IconName } from "@/components/ui/Icons";
import { useAdminAuth } from "@/lib/admin/client";

function AdminLoading() {
  return (
    <div className="min-h-dvh flex items-center justify-center">
      <div className="flex items-center gap-3 text-slate animate-pulse">
        <Icon name="shield" size={22} className="text-accent" />
        <span className="text-sm font-semibold">Verifying administrator…</span>
      </div>
    </div>
  );
}

export function AdminForbidden() {
  return (
    <div className="min-h-dvh flex items-center justify-center p-6">
      <GlassCard className="max-w-md w-full p-8 text-center">
        <span className="inline-flex h-14 w-14 rounded-2xl items-center justify-center mb-4 text-danger" style={{ background: "#ef44441a" }}>
          <Icon name="lock" size={26} />
        </span>
        <h1 className="text-xl font-bold text-snow">Access restricted</h1>
        <p className="text-sm text-slate mt-2 leading-relaxed">
          The Admin Console is available to administrators only. Your account does not have
          administrator privileges, and access attempts are logged.
        </p>
        <Link href="/dashboard" className="btn btn-primary mt-6">
          <Icon name="home" size={18} />
          Back to FinSight
        </Link>
      </GlassCard>
    </div>
  );
}

export default function AdminPage({
  title,
  subtitle,
  icon,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const auth = useAdminAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "unauthenticated") router.replace("/login");
  }, [auth.status, router]);

  if (auth.status === "loading" || auth.status === "unauthenticated") return <AdminLoading />;
  if (auth.status === "forbidden") return <AdminForbidden />;

  return (
    <AdminShell whoami={auth.whoami}>
      <PageHeader title={title} subtitle={subtitle} icon={icon} actions={actions} />
      {children}
    </AdminShell>
  );
}
