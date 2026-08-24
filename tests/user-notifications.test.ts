import { describe, it, expect } from "vitest";
import {
  matchBroadcastRoute,
  dbListBroadcasts,
  dbMarkBroadcastRead,
} from "@/lib/notificationsServer";
import { AuthApiError } from "@/lib/auth/errors";
import { createMockClient, type MockClient, type MockQueryOptions } from "./helpers/supabase-mock";

const USER_ID = "00000000-0000-4000-8000-000000000003";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000099";
const NOTIF_1 = "00000000-0000-4000-8000-000000000101";
const NOTIF_2 = "00000000-0000-4000-8000-000000000102";

function makeUserClient(tables: MockQueryOptions["tables"]): MockClient {
  return createMockClient({ user: { id: USER_ID, email: "user@example.com" }, tables });
}

function broadcastTables(): MockQueryOptions["tables"] {
  return {
    // Only rows RLS would let this user see are present: sent + addressed
    // to them. Drafts / other audiences never appear in unit tests because
    // they never appear through a user-scoped client in production either.
    admin_notifications: [
      {
        id: NOTIF_1,
        title: "Newer broadcast",
        body: "Second",
        audience: "all",
        channel: "inapp",
        status: "sent",
        sent_at: "2026-08-20T12:00:00Z",
        created_at: "2026-08-20T11:59:59Z",
      },
      {
        id: NOTIF_2,
        title: "Older broadcast",
        body: "First",
        audience: "users",
        channel: "both",
        status: "sent",
        sent_at: "2026-08-10T08:00:00Z",
        created_at: "2026-08-10T07:59:59Z",
      },
    ],
    notification_reads: [{ notification_id: NOTIF_2, user_id: USER_ID }],
  };
}

async function expectAuthError(promise: Promise<unknown>, status: number, code?: string) {
  try {
    await promise;
    expect.unreachable("expected AuthApiError");
  } catch (err) {
    expect(err).toBeInstanceOf(AuthApiError);
    if (status !== undefined) expect((err as AuthApiError).status).toBe(status);
    if (code !== undefined) expect((err as AuthApiError).code).toBe(code);
  }
}

describe("broadcast route matching", () => {
  it("maps GET / to the inbox list", () => {
    expect(matchBroadcastRoute("GET", [])).toEqual({ kind: "list" });
  });

  it("maps POST /:id/read to mark-read", () => {
    expect(matchBroadcastRoute("POST", [NOTIF_1, "read"])).toEqual({ kind: "read", id: NOTIF_1 });
  });

  it("rejects unknown shapes", () => {
    expect(matchBroadcastRoute("DELETE", [NOTIF_1])).toBeNull();
    expect(matchBroadcastRoute("POST", [NOTIF_1])).toBeNull();
    expect(matchBroadcastRoute("POST", [NOTIF_1, "read", "extra"])).toBeNull();
  });
});

describe("broadcast inbox listing", () => {
  it("lists newest-first merged with per-user read state", async () => {
    const client = makeUserClient(broadcastTables());
    const result = await dbListBroadcasts(client, USER_ID, null, null);

    expect(result.items.map((i) => i.id)).toEqual([NOTIF_1, NOTIF_2]);
    expect(result.items[0].is_read).toBe(false);
    expect(result.items[1].is_read).toBe(true);
    expect(result.unread).toBe(1);
    expect(result.total).toBe(2);
    expect(result.pages).toBe(1);
  });

  it("paginates and clamps out-of-range input", async () => {
    const client = makeUserClient(broadcastTables());
    const page2 = await dbListBroadcasts(client, USER_ID, "2", "1");
    expect(page2.items.map((i) => i.id)).toEqual([NOTIF_2]);
    expect(page2.page).toBe(2);
    expect(page2.pageSize).toBe(1);

    const clamped = await dbListBroadcasts(client, USER_ID, "abc", "999");
    expect(clamped.page).toBe(1);
    expect(clamped.pageSize).toBe(50);
  });

  it("returns an empty page rather than failing when nothing was ever sent", async () => {
    const client = makeUserClient({ admin_notifications: [] });
    const result = await dbListBroadcasts(client, USER_ID, null, null);
    expect(result.items).toEqual([]);
    expect(result.unread).toBe(0);
  });
});

describe("marking broadcasts read", () => {
  it("writes a read marker scoped to the session user", async () => {
    const client = makeUserClient(broadcastTables());
    const result = await dbMarkBroadcastRead(client, USER_ID, NOTIF_1);
    expect(result).toEqual({ id: NOTIF_1, read: true });

    const write = client.writes.find((w) => w.table === "notification_reads" && w.kind === "upsert");
    expect(write).toBeDefined();
    expect((write!.payload as { user_id: string }).user_id).toBe(USER_ID);
    expect((write!.payload as { notification_id: string }).notification_id).toBe(NOTIF_1);
  });

  it("never trusts a caller-supplied user id", async () => {
    const client = makeUserClient(broadcastTables());
    await dbMarkBroadcastRead(client, USER_ID, NOTIF_1);
    const write = client.writes.find((w) => w.table === "notification_reads")!;
    expect((write.payload as { user_id: string }).user_id).not.toBe(OTHER_USER_ID);
  });

  it("treats an invisible notification as missing and writes no marker", async () => {
    const client = makeUserClient(broadcastTables());
    // Not present at all (RLS would hide it) -> identical to not-found.
    await expectAuthError(dbMarkBroadcastRead(client, USER_ID, TX_MISSING), 404, "not_found");
    expect(client.writes.find((w) => w.table === "notification_reads")).toBeUndefined();
  });

  it("rejects malformed ids before touching the database", async () => {
    const client = makeUserClient(broadcastTables());
    await expectAuthError(dbMarkBroadcastRead(client, USER_ID, "not-a-uuid"), 400, "bad_request");
    expect(client.writes.length).toBe(0);
  });
});

const TX_MISSING = "00000000-0000-4000-8000-000000000555";
