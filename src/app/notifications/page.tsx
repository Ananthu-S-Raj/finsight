"use client";

import { useEffect } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import BroadcastInbox from "@/components/BroadcastInbox";
import NotificationCenter from "@/components/NotificationCenter";
import { useRequireAuth } from "@/lib/useAuth";
import { usePageData } from "@/lib/usePageData";
import { useNotifications } from "@/lib/notifications";

export default function NotificationsPage() {
  const userId = useRequireAuth();
  const { profile, txns } = usePageData(userId, 50);
  const { items, unread, markRead, markAllRead, remove } = useNotifications(
    txns as {
      id: string;
      type: string;
      amount: number;
      overspend_amount: number;
      category: string | null;
      note: string | null;
      created_at: string;
    }[]
  );

  useEffect(() => {
    document.title = "Notifications · FinSight";
  }, []);

  return (
    <AppShell userId={userId ?? ""} profile={profile ? { full_name: profile.full_name, email: profile.email, role: profile.role } : null}>
      <PageHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread notification${unread > 1 ? "s" : ""}` : "You're all caught up"}
        icon="bell"
      />
      <div className="animate-fade-up space-y-6">
        <BroadcastInbox />
        <NotificationCenter
          items={items}
          markRead={markRead}
          markAllRead={markAllRead}
          remove={remove}
        />
      </div>
    </AppShell>
  );
}
