"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./ui/Icons";
import Button from "./ui/Button";
import { timeAgo } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import {
  listBroadcasts,
  markBroadcastRead,
} from "@/lib/broadcastsApi";
import type { BroadcastItem } from "@/lib/notificationsServer";

const PAGE_SIZE = 10;

/**
 * Inbox for admin broadcast announcements, backed by the server (unlike the
 * local notification center below it): read state is stored per user in the
 * database via /api/v1/notifications/:id/read, so it follows the account
 * across devices.
 */
export default function BroadcastInbox() {
  const [items, setItems] = useState<BroadcastItem[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (nextPage: number) => {
    if (nextPage === 1) setStatus("loading");
    else setLoadingMore(true);
    try {
      const data = await listBroadcasts(nextPage, PAGE_SIZE);
      setItems((prev) => (nextPage === 1 ? data.items : [...prev, ...data.items]));
      setPages(data.pages);
      setTotal(data.total);
      setPage(nextPage);
      setStatus("ready");
    } catch (err) {
      console.error(err);
      setStatus("error");
    } finally {
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load(1);
  }, [load]);

  async function markRead(item: BroadcastItem) {
    if (item.is_read) return;
    haptic("light");
    // Optimistic flip; roll back if the server disagrees.
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, is_read: true } : i))
    );
    try {
      await markBroadcastRead(item.id);
    } catch {
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, is_read: false } : i))
      );
    }
  }

  const unread = items.filter((i) => !i.is_read).length;

  return (
    <section aria-label="Announcements" className="space-y-2.5">
      <div className="flex items-center gap-2 px-1">
        <Icon name="bell" size={15} />
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate">
          Announcements
        </h2>
        {unread > 0 && (
          <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-accent/15 text-accent">
            {unread} new
          </span>
        )}
        {status === "ready" && (
          <span className="ml-auto text-[13px] text-muted">
            {total} broadcast{total === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {status === "loading" && (
        <div className="space-y-2.5" role="status" aria-label="Loading announcements">
          {[0, 1].map((i) => (
            <div key={i} className="glass-soft rounded-2xl p-4 animate-pulse">
              <div className="h-4 w-1/3 rounded bg-white/5" />
              <div className="h-3 w-full mt-2.5 rounded bg-white/5" />
              <div className="h-3 w-2/3 mt-2 rounded bg-white/5" />
            </div>
          ))}
        </div>
      )}

      {status === "error" && (
        <div className="glass rounded-2xl p-8 flex flex-col items-center text-center gap-3">
          <span className="h-12 w-12 rounded-2xl glass items-center justify-center inline-flex text-danger">
            <Icon name="alert" size={20} />
          </span>
          <p className="text-sm text-slate">Announcements couldn&apos;t be loaded.</p>
          <Button variant="ghost" icon="refresh" onClick={() => void load(1)}>
            Try again
          </Button>
        </div>
      )}

      {status === "ready" && items.length === 0 && (
        <div className="glass rounded-2xl p-8 flex flex-col items-center text-center gap-3">
          <span className="h-12 w-12 rounded-2xl glass items-center justify-center inline-flex text-slate">
            <Icon name="bellOff" size={20} />
          </span>
          <p className="text-sm text-slate">No announcements yet</p>
        </div>
      )}

      {status === "ready" && items.length > 0 && (
        <>
          <div className="space-y-2.5">
            {items.map((n) => (
              <div
                key={n.id}
                className={`glass-soft rounded-2xl p-4 flex items-start gap-3.5 row-press transition-colors ${n.is_read ? "" : "border-accent/25"}`}
                onClick={() => void markRead(n)}
                role="button"
                tabIndex={0}
                aria-label={`${n.title}. ${n.body}. ${n.is_read ? "Read" : "Unread"}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void markRead(n);
                  }
                }}
              >
                <span
                  className={`h-11 w-11 rounded-xl inline-flex items-center justify-center shrink-0 ${n.is_read ? "bg-white/[0.04] text-muted" : "bg-accent/10 text-accent"}`}
                >
                  <Icon name="bell" size={19} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-semibold truncate ${n.is_read ? "text-frost" : "text-snow"}`}>
                      {n.title}
                    </p>
                    {!n.is_read && (
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ background: "#6366f1", boxShadow: "0 0 6px #6366f1" }}
                      />
                    )}
                  </div>
                  <p className="text-sm text-slate mt-0.5 leading-snug whitespace-pre-line">{n.body}</p>
                  <p className="text-[13px] text-muted mt-1">
                    {timeAgo(n.sent_at ?? n.created_at)}
                  </p>
                </div>
                {!n.is_read && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void markRead(n);
                    }}
                    aria-label="Mark as read"
                    className="neo h-11 w-11 rounded-xl inline-flex items-center justify-center text-slate hover:text-accent"
                  >
                    <Icon name="check" size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {page < pages && (
            <div className="flex justify-center pt-1">
              <Button variant="ghost" disabled={loadingMore} onClick={() => void load(page + 1)}>
                {loadingMore ? "Loading…" : `Load more (${total - items.length} left)`}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
