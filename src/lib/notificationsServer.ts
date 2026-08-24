/**
 * Server-side operations for the user-facing broadcast inbox. These run
 * against a user-scoped Supabase client (never the service role), so RLS is
 * the sole authority for which broadcasts a user may see: only rows with
 * status='sent' that are addressed to them ("notifications: read sent"
 * policy on admin_notifications). Read markers live in notification_reads
 * and are confined to their owner by that table's own policies.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthApiError } from "@/lib/auth/errors";

export type BroadcastItem = {
  id: string;
  title: string;
  body: string;
  audience: string;
  channel: string;
  sent_at: string | null;
  created_at: string;
  is_read: boolean;
};

export type BroadcastList = {
  items: BroadcastItem[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  unread: number;
};

export type BroadcastRoute =
  | { kind: "list" }
  | { kind: "read"; id: string };

/** Maps a request to an operation. `slug` is the path after /api/v1/notifications. */
export function matchBroadcastRoute(method: string, slug: string[]): BroadcastRoute | null {
  const s = slug ?? [];
  const m = method.toUpperCase();

  if (m === "GET" && s.length === 0) return { kind: "list" };
  if (m === "POST" && s.length === 2 && s[1] === "read") return { kind: "read", id: s[0] };

  return null;
}

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;

function assertId(id: string): void {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
    throw new AuthApiError(400, "Invalid id.", "bad_request");
  }
}

/**
 * Lists sent broadcasts visible to this user, newest first, merged with
 * per-user read state. Audience filtering happens entirely inside RLS —
 * the handler never needs to know who the recipients are.
 */
export async function dbListBroadcasts(
  client: SupabaseClient,
  _userId: string,
  pageRaw: string | null,
  pageSizeRaw: string | null
): Promise<BroadcastList> {
  const page = Math.max(1, Number.parseInt(pageRaw ?? "", 10) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number.parseInt(pageSizeRaw ?? "", 10) || PAGE_SIZE_DEFAULT)
  );
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // The eq(status,"sent") filter is belt-and-braces: RLS already restricts
  // selects to sent rows, and being explicit keeps ordering meaningful.
  const { data, count, error } = await client
    .from("admin_notifications")
    .select("id,title,body,audience,channel,sent_at,created_at", { count: "exact" })
    .eq("status", "sent")
    .order("sent_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw new AuthApiError(500, "Couldn't load notifications.", "db_error");

  const rows = (data ?? []) as Array<Omit<BroadcastItem, "is_read">>;

  let readIds = new Set<string>();
  if (rows.length > 0) {
    const { data: reads, error: readError } = await client
      .from("notification_reads")
      .select("notification_id")
      .in(
        "notification_id",
        rows.map((r) => r.id)
      );
    if (readError) throw new AuthApiError(500, "Couldn't load read state.", "db_error");
    readIds = new Set((reads ?? []).map((r) => r.notification_id as string));
  }

  const items: BroadcastItem[] = rows.map((r) => ({
    ...r,
    is_read: readIds.has(r.id),
  }));

  const total = count ?? 0;
  return {
    items,
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    unread: items.filter((i) => !i.is_read).length,
  };
}

/**
 * Marks one broadcast read for this user. Visibility is re-checked through
 * RLS first — a notification outside the caller's audience looks exactly
 * like a missing one (404) and no marker row is ever written.
 */
export async function dbMarkBroadcastRead(
  client: SupabaseClient,
  userId: string,
  id: string
): Promise<{ id: string; read: boolean }> {
  assertId(id);

  const { data: existing, error } = await client
    .from("admin_notifications")
    .select("id")
    .eq("id", id)
    .eq("status", "sent")
    .maybeSingle();
  if (error) throw new AuthApiError(500, "Couldn't verify the notification.", "db_error");
  if (!existing) throw new AuthApiError(404, "Notification not found.", "not_found");

  // user_id ALWAYS comes from the verified session token — never from input.
  const { error: upsertError } = await client.from("notification_reads").upsert(
    { notification_id: id, user_id: userId },
    { ignoreDuplicates: true }
  );
  if (upsertError) throw new AuthApiError(500, "Couldn't mark the notification as read.", "db_error");

  return { id, read: true };
}
