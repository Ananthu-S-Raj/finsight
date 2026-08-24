"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { IconName } from "@/components/ui/Icons";
import { inr } from "./format";
import { playSound } from "./sound";

export type NotificationItem = {
  id: string;
  category: "budget" | "payments" | "savings" | "system";
  icon: IconName;
  title: string;
  message: string;
  at: number;
  read: boolean;
  /** Optional in-app route to open when the notification is tapped. */
  route?: string;
};

const STORE_KEY = "finsight:notifications";
const SEED_KEY = "finsight:notifications:seed";

function readStore(): NotificationItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as NotificationItem[]) : [];
  } catch {
    return [];
  }
}

function writeStore(items: NotificationItem[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(items.slice(0, 80)));
  } catch {
    // storage unavailable
  }
}

/**
 * Adds an item to the notification store unless one with the same id already
 * exists (so repeated app loads never duplicate e.g. "payment due tomorrow"
 * reminders). Returns true when a new item was stored.
 */
export function addNotificationIfMissing(item: NotificationItem): boolean {
  if (typeof window === "undefined") return false;
  const items = readStore();
  if (items.some((n) => n.id === item.id)) return false;
  writeStore([item, ...items]);
  return true;
}

export type PushPayload = {
  category?: string;
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
};

/** Maps a web-push payload into an in-app notification item. Pure + testable. */
export function mapPushPayload(p: PushPayload): Omit<NotificationItem, "id" | "read" | "at"> {
  const category: NotificationItem["category"] =
    p.category === "budget"
      ? "budget"
      : p.category === "card"
        ? "payments"
        : p.category === "savings"
          ? "savings"
          : "system";
  const icon: IconName =
    category === "budget"
      ? "alert"
      : category === "payments"
        ? "card"
        : category === "savings"
          ? "piggy"
          : "bell";
  return {
    category,
    icon,
    title: p.title || "FinSight",
    message: p.body || "",
    route: p.url && p.url.startsWith("/") ? p.url : undefined,
  };
}

/** Seeds client-side notifications from real data (overspend events etc). */
export function useNotifications(transactions?: {
  id: string;
  type: string;
  amount: number;
  overspend_amount: number;
  category: string | null;
  note: string | null;
  created_at: string;
}[]) {
  const [items, setItems] = useState<NotificationItem[]>([]);

  // Seed derived notifications once when transactions arrive.
  useEffect(() => {
    if (!transactions || transactions.length === 0) return;
    try {
      if (localStorage.getItem(SEED_KEY)) return;
      const derived: NotificationItem[] = [];

      const overspends = transactions.filter(
        (t) => Number(t.overspend_amount) > 0
      );
      if (overspends.length > 0) {
        const t = overspends[0];
        derived.push({
          id: `overspend-${t.id}`,
          category: "budget",
          icon: "alert",
          title: "Over budget",
          message: `You went ₹${Math.round(
            Number(t.overspend_amount)
          )} over budget — it was covered from your salary balance.`,
          at: new Date(t.created_at).getTime(),
          read: false,
          route: "/budgets",
        });
      }

      if (derived.length > 0) {
        localStorage.setItem(SEED_KEY, "1");
        writeStore(derived);
        setItems((prev) => [...derived, ...prev]);
      }
    } catch {
      // non-fatal
    }
  }, [transactions]);

  useEffect(() => {
    setItems(readStore());
  }, []);

  const unread = useMemo(() => items.filter((i) => !i.read).length, [items]);

  const markRead = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.map((i) => (i.id === id ? { ...i, read: true } : i));
      writeStore(next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setItems((prev) => {
      const next = prev.map((i) => ({ ...i, read: true }));
      writeStore(next);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.id !== id);
      writeStore(next);
      return next;
    });
  }, []);

  const add = useCallback((item: Omit<NotificationItem, "id" | "read" | "at"> & { at?: number }) => {
    setItems((prev) => {
      const next: NotificationItem[] = [
        {
          ...item,
          id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          read: false,
          at: item.at ?? Date.now(),
        },
        ...prev,
      ];
      writeStore(next);
      return next;
    });
  }, []);

  const addOverspend = useCallback(
    (amount: number) => {
      add({
        category: "budget",
        icon: "alert",
        title: "Over budget",
        message: `You're now ₹${inr(amount)} over budget this month.`,
        route: "/budgets",
      });
    },
    [add]
  );

  // Sync incoming web-push notifications into the in-app center while the app
  // is open (the service worker posts a message when a push arrives).
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const handler = (event: MessageEvent) => {
      const data = event.data as { type?: string; payload?: PushPayload } | null;
      if (!data || data.type !== "finsight-push" || !data.payload) return;
      const p = data.payload;
      const item = mapPushPayload(p);
      add(item);
      playSound("notification");
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [add]);

  return { items, unread, markRead, markAllRead, remove, add, addOverspend };
}
