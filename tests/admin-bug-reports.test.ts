import { describe, it, expect } from "vitest";
import { listBugReports, updateBugReport } from "@/lib/admin/handlers/bugReports";
import { ApiError } from "@/lib/admin/server";
import { createMockClient, type MockClient, type MockQueryOptions } from "./helpers/supabase-mock";
import { ALL_PERMISSIONS, type PermissionCode } from "@/lib/admin/permissions";
import type { AdminContext } from "@/lib/admin/server";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000003";
const USER2_ID = "00000000-0000-4000-8000-000000000004";

function bugRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    user_id: USER_ID,
    title: "Dashboard freezes",
    description: "It freezes whenever I open the overview.",
    category: "bug",
    severity: "high",
    steps_to_reproduce: null,
    expected_behavior: null,
    actual_behavior: null,
    page_url: null,
    user_agent: null,
    status: "open",
    admin_notes: null,
    created_at: "2026-09-01T08:00:00Z",
    updated_at: "2026-09-01T08:00:00Z",
    ...overrides,
  };
}

function profilesFor(): Record<string, unknown>[] {
  return [
    { id: USER_ID, email: "user1@example.com", full_name: "User One" },
    { id: USER2_ID, email: "user2@example.com", full_name: "User Two" },
  ];
}

const REPORTS = [
  bugRow({
    id: "00000000-0000-4000-8000-000000000010",
    title: "Dashboard freezes",
    user_id: USER_ID,
    created_at: "2026-09-02T10:00:00Z",
  }),
  bugRow({
    id: "00000000-0000-4000-8000-000000000011",
    title: "Invoice never generates",
    user_id: USER2_ID,
    category: "other",
    severity: "low",
    status: "resolved",
    admin_notes: "Fixed in v2.3.",
    created_at: "2026-09-01T10:00:00Z",
  }),
  bugRow({
    id: "00000000-0000-4000-8000-000000000012",
    title: "Push notifications arrive late",
    user_id: USER_ID,
    category: "performance",
    severity: "medium",
    created_at: "2026-08-30T10:00:00Z",
  }),
];

function makeClient(extraTables?: MockQueryOptions["tables"]): MockClient {
  const opts: MockQueryOptions = {
    tables: { bug_reports: REPORTS.map((r) => ({ ...r })), profiles: profilesFor(), ...extraTables },
  };
  return createMockClient(opts);
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

async function expectApiError(runner: Promise<unknown>, status: number, code: string, part?: string) {
  try {
    await runner;
    expect.unreachable("expected ApiError");
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(status);
    expect(apiErr.code).toBe(code);
    if (part) expect(apiErr.message).toContain(part);
  }
}

describe("listBugReports", () => {
  it("returns all reports newest first with pagination metadata", async () => {
    const client = makeClient();
    const result = (await listBugReports(makeCtx(client), new Request("http://localhost"), {})) as {
      items: Array<{ id: string; title: string }>;
      total: number;
      page: number;
      pageSize: number;
      pages: number;
    };
    expect(result.items.map((i) => i.id)).toEqual([
      "00000000-0000-4000-8000-000000000010",
      "00000000-0000-4000-8000-000000000011",
      "00000000-0000-4000-8000-000000000012",
    ]);
    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.pages).toBe(1);
  });

  it("attaches the reporter identity from the batched profiles lookup", async () => {
    const client = makeClient();
    const result = (await listBugReports(makeCtx(client), new Request("http://localhost"), {})) as {
      items: Array<{ id: string; user: { email: string | null; full_name: string | null } | null }>;
    };
    expect(result.items[0].user).toEqual({ id: USER_ID, email: "user1@example.com", full_name: "User One" });
    // Unknown reporter degrades to null rather than erroring.
    expect(result.items[1].user).toEqual({ id: USER2_ID, email: "user2@example.com", full_name: "User Two" });
  });

  it("filters by status", async () => {
    const client = makeClient();
    const result = (await listBugReports(makeCtx(client), new Request("http://localhost"), {
      status: "resolved",
    })) as { items: Array<{ id: string }>; total: number };
    expect(result.items.map((i) => i.id)).toEqual(["00000000-0000-4000-8000-000000000011"]);
    expect(result.total).toBe(1);
  });

  it("rejects an unknown status with the allowed vocabulary", async () => {
    const client = makeClient();
    await expectApiError(
      listBugReports(makeCtx(client), new Request("http://localhost"), { status: "shipped" }),
      400,
      "bad_request",
      "open, in_progress, resolved, closed"
    );
  });

  it("filters by category", async () => {
    const client = makeClient();
    const result = (await listBugReports(makeCtx(client), new Request("http://localhost"), {
      category: "performance",
    })) as { items: Array<{ id: string }>; total: number };
    expect(result.items.map((i) => i.id)).toEqual(["00000000-0000-4000-8000-000000000012"]);
  });

  it("rejects an unknown category", async () => {
    const client = makeClient();
    await expectApiError(
      listBugReports(makeCtx(client), new Request("http://localhost"), { category: "feature-request" }),
      400,
      "bad_request",
      "bug, performance"
    );
  });

  it("searches the title case-insensitively", async () => {
    const client = makeClient();
    const result = (await listBugReports(makeCtx(client), new Request("http://localhost"), {
      search: "DASHBOAR", // deliberately wrong case: ilike is case-insensitive
    })) as { items: Array<{ id: string }>; total: number };
    // PostgREST .or() with ilike is case-insensitive; only the title matches.
    expect(result.items.map((i) => i.id)).toEqual(["00000000-0000-4000-8000-000000000010"]);
    expect(result.total).toBe(1);
  });

  it("paginates over the full filtered result set", async () => {
    const client = makeClient();
    const page2 = (await listBugReports(makeCtx(client), new Request("http://localhost"), {
      page: "2",
      pageSize: "2",
    })) as { items: Array<{ id: string }>; total: number; pages: number };
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].id).toBe("00000000-0000-4000-8000-000000000012");
    expect(page2.total).toBe(3);
    expect(page2.pages).toBe(2);
  });

  it("combines status and search", async () => {
    const client = makeClient();
    const result = (await listBugReports(makeCtx(client), new Request("http://localhost"), {
      status: "resolved",
      search: "nv",
    })) as { items: Array<{ id: string }>; total: number };
    expect(result.items.map((i) => i.id)).toEqual(["00000000-0000-4000-8000-000000000011"]);
    expect(result.total).toBe(1);
  });

  it("denies admins without BUG_REPORT_MANAGE", async () => {
    const client = makeClient();
    const ctx = makeCtx(client, ALL_PERMISSIONS.filter((p) => p !== "BUG_REPORT_MANAGE"));
    await expectApiError(
      listBugReports(ctx, new Request("http://localhost"), {}),
      403,
      "forbidden",
      "BUG_REPORT_MANAGE"
    );
  });
});

describe("updateBugReport", () => {
  const REPORT_ID = "00000000-0000-4000-8000-000000000010";

  const patch = (body: Record<string, unknown>) =>
    new Request("http://localhost", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("updates status and admin_notes, then writes the audit trail", async () => {
    const client = makeClient();
    const updated = (await updateBugReport(makeCtx(client), patch({ status: "in_progress", admin_notes: "  Reproduced in v1.9.  " }), {
      id: REPORT_ID,
    })) as { id: string; status: string; admin_notes: string; updated_at: string };

    expect(updated.id).toBe(REPORT_ID);
    expect(updated.status).toBe("in_progress");
    expect(updated.admin_notes).toBe("Reproduced in v1.9.");
    expect(updated.updated_at).toBeTruthy();

    const update = client.writes.find((w) => w.table === "bug_reports" && w.kind === "update");
    expect(update).toBeTruthy();
    expect(update?.filters).toContainEqual({ col: "id", op: "eq", val: REPORT_ID });

    const audit = client.writes.find((w) => w.table === "audit_logs" && w.kind === "insert")?.payload as Record<string, unknown>;
    expect(audit.action).toBe("bug_report.update");
    expect(audit.resource_type).toBe("bug_report");
    expect(audit.resource_id).toBe(REPORT_ID);
    expect(audit.target_user_id).toBe(USER_ID);
    // Only the triage fields are audited — never the server-bumped updated_at.
    expect(audit.metadata).toEqual({ status: "in_progress", admin_notes: "Reproduced in v1.9." });
  });

  it("clears admin_notes when an empty string is sent", async () => {
    const client = makeClient();
    const updated = (await updateBugReport(makeCtx(client), patch({ admin_notes: "   " }), {
      id: REPORT_ID,
    })) as { admin_notes: string | null };
    expect(updated.admin_notes).toBeNull();
  });

  it("rejects an invalid status value", async () => {
    const client = makeClient();
    await expectApiError(
      updateBugReport(makeCtx(client), patch({ status: "done" }), { id: REPORT_ID }),
      400,
      "bad_request"
    );
  });

  it("rejects an update with no supported fields", async () => {
    const client = makeClient();
    await expectApiError(
      updateBugReport(makeCtx(client), patch({ comment: "beep" }), { id: REPORT_ID }),
      400,
      "bad_request"
    );
  });

  it("rejects a malformed report id", async () => {
    const client = makeClient();
    await expectApiError(
      updateBugReport(makeCtx(client), patch({ status: "resolved" }), { id: "not-a-uuid" }),
      400,
      "bad_request"
    );
  });

  it("returns 404 when the report does not exist", async () => {
    const client = makeClient();
    await expectApiError(
      updateBugReport(makeCtx(client), patch({ status: "resolved" }), {
        id: "00000000-0000-4000-8000-0000000000ff",
      }),
      404,
      "not_found"
    );
  });

  it("denies admins without BUG_REPORT_MANAGE", async () => {
    const client = makeClient();
    const ctx = makeCtx(client, ALL_PERMISSIONS.filter((p) => p !== "BUG_REPORT_MANAGE"));
    await expectApiError(
      updateBugReport(ctx, patch({ status: "resolved" }), { id: REPORT_ID }),
      403,
      "forbidden"
    );
    expect(client.writes.length).toBe(0);
  });
});