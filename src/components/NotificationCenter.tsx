"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Icon, { type IconName } from "./ui/Icons";
import SegmentedControl from "./ui/SegmentedControl";
import Button from "./ui/Button";
import { timeAgo } from "@/lib/format";
import type { NotificationItem } from "@/lib/notifications";
import { haptic } from "@/lib/haptics";

type Filter = "all" | "unread" | "budget" | "payments" | "savings" | "system";

const CAT_ICON: Record<string, IconName> = {
  budget: "budgets",
  payments: "card",
  savings: "piggy",
  system: "shield",
};

export default function NotificationCenter({
  items,
  markRead,
  markAllRead,
  remove,
}: {
  items: NotificationItem[];
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "unread") return items.filter((i) => !i.read);
    return items.filter((i) => i.category === filter);
  }, [items, filter]);

  function openItem(n: NotificationItem) {
    haptic("light");
    markRead(n.id);
    if (n.route) router.push(n.route);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <SegmentedControl
          value={filter}
          label="Filter notifications"
          options={[
            { value: "all", label: "All" },
            { value: "unread", label: "Unread" },
            { value: "budget", label: "Budget" },
            { value: "payments", label: "Payments" },
            { value: "savings", label: "Savings" },
            { value: "system", label: "System" },
          ]}
          onChange={setFilter}
        />
        {items.some((i) => !i.read) && (
          <Button
            variant="ghost"
            icon="check"
            onClick={() => {
              haptic("toggle");
              markAllRead();
            }}
            className="!text-sm"
          >
            Mark all read
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="glass rounded-2xl p-10 flex flex-col items-center text-center gap-3">
          <span className="h-14 w-14 rounded-2xl glass items-center justify-center inline-flex text-slate">
            <Icon name="bellOff" size={24} />
          </span>
          <p className="text-snow font-semibold">All caught up</p>
          <p className="text-sm text-slate max-w-xs">
            Budget alerts, card reminders and savings nudges will show up here.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((n) => (
            <div
              key={n.id}
              className={`glass-soft rounded-2xl p-4 flex items-start gap-3.5 row-press transition-colors ${n.read ? "" : "border-accent/25"}`}
              onClick={() => openItem(n)}
              role="button"
              tabIndex={0}
              aria-label={`${n.title}. ${n.message}. ${n.read ? "Read" : "Unread"}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openItem(n);
                }
              }}
            >
              <span
                className="h-11 w-11 rounded-xl inline-flex items-center justify-center shrink-0"
                style={{
                  background: n.read ? "var(--tint)" : `${n.category === "budget" ? "#f59e0b" : n.category === "payments" ? "#6366f1" : n.category === "savings" ? "#10b981" : "#94a3b8"}1a`,
                  color: n.read ? "#94a3b8" : n.category === "budget" ? "#f59e0b" : n.category === "payments" ? "#6366f1" : n.category === "savings" ? "#10b981" : "#cbd5e1",
                }}
              >
                <Icon name={CAT_ICON[n.category]} size={19} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-semibold truncate ${n.read ? "text-frost" : "text-snow"}`}>
                    {n.title}
                  </p>
                  {!n.read && (
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
                  )}
                </div>
                <p className="text-sm text-slate mt-0.5 leading-snug">{n.message}</p>
                <p className="text-[13px] text-muted mt-1">{timeAgo(new Date(n.at).toISOString())}</p>
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                {!n.read && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      markRead(n.id);
                    }}
                    aria-label="Mark as read"
                    className="neo h-11 w-11 rounded-xl inline-flex items-center justify-center text-slate hover:text-accent"
                  >
                    <Icon name="check" size={16} />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    haptic("light");
                    remove(n.id);
                  }}
                  aria-label="Delete notification"
                  className="neo h-11 w-11 rounded-xl inline-flex items-center justify-center text-slate hover:text-danger"
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
