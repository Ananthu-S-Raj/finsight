// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createMockClient, type MockClient, type MockQueryOptions } from "./helpers/supabase-mock";
import { ALL_PERMISSIONS, type PermissionCode } from "@/lib/admin/permissions";
import type { AdminContext } from "@/lib/admin/server";
import { sendNotification } from "@/lib/admin/handlers/notifications";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const NOTIF_ID = "00000000-0000-4000-8000-000000000042";

/**
 * Recipient-count semantics (G-04 companion): at send time the handler must
 * persist `recipient_count` in the notification.send audit metadata. The
 * count is the in-app audience resolved per the "notifications: read sent"
 * RLS policy — 'all'/'users' → every account (profiles rows), 'admins' →
 * admin accounts only (regular users cannot read that audience), 'selected'
 * → explicit target list. It is NEVER derived from push subscriptions and
 * never implies push delivery.
 */
describe("notification send recipient_count metadata", () => {
  const NOTIF = {
    id: NOTIF_ID,
    title: "Release notes",
    body: "Hello",
    audience: "users",
    channel: "inapp",
    target_user_ids: null,
    status: "draft",
    error: null,
    created_by: ADMIN_ID,
    created_at: "2026-08-20T10:00:00Z",
    sent_at: null,
  };

  function tables(opts?: {
    profiles?: Record<string, unknown>[];
    notif?: Partial<typeof NOTIF>;
    pushSubs?: number;
  }): MockQueryOptions["tables"] {
    return {
      profiles:
        opts?.profiles ??
        [
          { id: "00000000-0000-4000-8000-000000000001", role: "admin" },
          { id: "00000000-0000-4000-8000-000000000002", role: "admin" },
          { id: "00000000-0000-4000-8000-000000000003", role: "user" },
        ],
      admin_notifications: [{ ...NOTIF, ...(opts?.notif ?? {}) }],
      push_subscriptions:
        opts?.pushSubs !== undefined
          ? Array.from({ length: opts.pushSubs }, (_, i) => ({
              id: `00000000-0000-4000-8000-${String(100 + i).padStart(12, "0")}`,
            }))
          : [],
      audit_logs: [],
    };
  }

  function makeCtx(client: MockClient, permissions: PermissionCode[] = [...ALL_PERMISSIONS]): AdminContext {
    return {
      userId: ADMIN_ID,
      email: "admin@finsight.app",
      role: "admin",
      permissions,
      token: "valid-token",
      ip: "127.0.0.1",
      userAgent: "vitest",
      client: client as never,
    };
  }

  function req(): Request {
    return new Request("http://localhost", { method: "POST" });
  }

  function sendAuditMeta(client: MockClient): Record<string, unknown> {
    const audit = client.writes.find(
      (w) => w.table === "audit_logs" && w.kind === "insert" && (w.payload as { action: string }).action === "notification.send"
    );
    expect(audit).toBeDefined();
    return (audit!.payload as { metadata: Record<string, unknown> }).metadata;
  }

  it("counts every account for a whole-platform audience ('all')", async () => {
    const client = createMockClient({ tables: tables({ notif: { audience: "all" } }) });
    await sendNotification(makeCtx(client), req(), { id: NOTIF_ID });
    expect(sendAuditMeta(client).recipient_count).toBe(3);
  });

  it("counts every account for a regular-users audience ('users')", async () => {
    const client = createMockClient({ tables: tables({ notif: { audience: "users" } }) });
    await sendNotification(makeCtx(client), req(), { id: NOTIF_ID });
    expect(sendAuditMeta(client).recipient_count).toBe(3);
  });

  it("counts only admin accounts for an admins-only audience", async () => {
    const client = createMockClient({ tables: tables({ notif: { audience: "admins" } }) });
    await sendNotification(makeCtx(client), req(), { id: NOTIF_ID });
    expect(sendAuditMeta(client).recipient_count).toBe(2); // 2 admins of 3 accounts
  });

  it("uses the explicit target list length for a selected audience", async () => {
    const targets = ["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"];
    const client = createMockClient({
      tables: tables({ notif: { audience: "selected", target_user_ids: targets } }),
    });
    await sendNotification(makeCtx(client), req(), { id: NOTIF_ID });
    expect(sendAuditMeta(client).recipient_count).toBe(2);
  });

  it("persists recipient_count 0 for an empty audience while keeping existing send semantics", async () => {
    const client = createMockClient({ tables: tables({ profiles: [] }) });
    const result = (await sendNotification(makeCtx(client), req(), { id: NOTIF_ID })) as Record<string, unknown>;
    // The broadcast still goes out exactly as before — zero recipients is a
    // legitimate outcome, not a failure.
    expect(result.status).toBe("sent");
    expect(sendAuditMeta(client).recipient_count).toBe(0);
  });

  it("never derives the count from push subscribers", async () => {
    const client = createMockClient({
      // 'both' channel + 7 devices vs 3 real accounts.
      tables: tables({ notif: { channel: "both" }, pushSubs: 7 }),
    });
    await sendNotification(makeCtx(client), req(), { id: NOTIF_ID });
    const meta = sendAuditMeta(client);
    expect(meta.recipient_count).toBe(3);
    expect(meta.recipient_count).not.toBe(7);
    // And it still refuses to claim a push delivery happened.
    expect(meta.dispatch).toBe("in_app_delivered");
    expect(meta.push_dispatch).toBe("not_configured");
  });

  it("keeps the truthful dispatch disclosure alongside the count", async () => {
    const client = createMockClient({ tables: tables() }); // channel: inapp
    await sendNotification(makeCtx(client), req(), { id: NOTIF_ID });
    const meta = sendAuditMeta(client);
    expect(meta.dispatch).toBe("in_app_delivered");
    expect(meta.push_dispatch).toBeUndefined();
    expect(meta.audience).toBe("users");
    expect(meta.channel).toBe("inapp");
  });

  it("leaves draft/send behavior unchanged apart from the additive metadata", async () => {
    const client = createMockClient({ tables: tables() });
    const result = (await sendNotification(makeCtx(client), req(), { id: NOTIF_ID })) as Record<string, unknown>;
    expect(result.status).toBe("sent");
    expect(result.sent_at).toBeTruthy();
    const row = client.tables.admin_notifications[0] as Record<string, unknown>;
    expect(row.status).toBe("sent");
    expect(row.error).toBeNull();
    expect(row.sent_at).toBeTruthy();
  });

  it("refuses to send when the audience cannot be resolved (no silent wrong count)", async () => {
    const base = tables();
    const client = createMockClient({ tables: base });
    // Sabotage ONLY profile reads so the count query errors.
    const originalFrom = client.from.bind(client);
    (client as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      if (table === "profiles") {
        return Object.assign(originalFrom(table), {
          select() {
            return this;
          },
          then(res: (v: unknown) => unknown) {
            return Promise.resolve({ data: null, count: null, error: { message: "profiles unreadable" } }).then(res);
          },
        });
      }
      return originalFrom(table);
    };
    try {
      await expect(sendNotification(makeCtx(client), req(), { id: NOTIF_ID })).rejects.toMatchObject({
        status: 502,
        code: "db_error",
      });
      // Nothing mutated, nothing audited.
      expect((client.tables.admin_notifications[0] as Record<string, unknown>).status).toBe("draft");
      expect(client.writes.length).toBe(0);
    } finally {
      (client as unknown as { from: (t: string) => unknown }).from = originalFrom as never;
    }
  });
});
