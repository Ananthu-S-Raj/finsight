// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { useAdminDataMock, useAdminAuthMock } = vi.hoisted(() => ({
  useAdminDataMock: vi.fn(),
  useAdminAuthMock: vi.fn(),
}));

vi.mock("@/lib/admin/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/admin/client")>();
  return { ...original, useAdminAuth: useAdminAuthMock };
});
vi.mock("@/lib/admin/useAdminData", () => ({
  useAdminData: useAdminDataMock,
  useMaintenanceStatus: () => ({ maintenance: false, loaded: true }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/admin/dashboard",
}));
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { signOut: vi.fn(async () => ({})) } },
}));

import AdminDashboard from "@/app/admin/dashboard/page";

const ACTIVITY_PATH = "/audit-logs?page=1&pageSize=5";

const OVERVIEW_DATA = {
  users: { total: 3, active: 3, disabled: 0, suspended: 0, admins: 1, verified: 3, unverified: 0 },
  finance: { transactions: 10, income: 1000, expenses: 500, savings: 200, active_budgets: 1 },
  notifications: { sent_last_7_days: 2 },
  push: { subscribers: 4 },
  health: { database: true, backend: true, ai: false, notifications: true, pwa: true, maintenance: false, app_name: "FinSight" },
};

const AI_DATA = {
  config: { enabled: false, admin_toggle: false, provider: "openai", model: "gpt-x", configured: false, features: {}, last_health_check: null },
  health: { reachable: false, latency_ms: null, model: null, detail: "AI not configured" },
};

function auditRow(i: number) {
  return {
    id: `a${i}`,
    actor_id: "00000000-0000-4000-8000-000000000001",
    actor_email: `admin${i}@finsight.app`,
    action: "user.suspend",
    resource_type: "user",
    resource_id: "00000000-0000-4000-8000-000000000003",
    target_user_id: "00000000-0000-4000-8000-000000000003",
    target_email: `user${i}@example.com`,
    metadata: {},
    ip: null,
    user_agent: null,
    result: "success",
    reason: null,
    created_at: `2026-08-2${i}T10:00:00Z`,
  };
}

const LATEST_FIVE = [5, 4, 3, 2, 1].map(auditRow); // newest first

type ActivityState =
  | { kind: "ok"; items?: unknown[] }
  | { kind: "error" }
  | { kind: "loading" };

/** Complete data dispatcher so every dashboard query has an answer. */
function makeImpl(activity: ActivityState) {
  return (path: string | null) => {
    if (path === "/overview") {
      return { status: "ready", data: OVERVIEW_DATA, error: null, refresh: vi.fn() };
    }
    if (path === "/ai/status") {
      return { status: "ready", data: AI_DATA, error: null, refresh: vi.fn() };
    }
    if (path === ACTIVITY_PATH) {
      if (activity.kind === "error") {
        return { status: "error", data: null, error: { message: "audit store down" }, refresh: vi.fn() };
      }
      if (activity.kind === "loading") {
        return { status: "loading", data: null, error: null, refresh: vi.fn() };
      }
      const items = activity.items ?? LATEST_FIVE;
      return {
        status: "ready",
        data: { items, total: items.length, page: 1, pageSize: 5, pages: Math.max(1, Math.ceil(items.length / 5)) },
        error: null,
        refresh: vi.fn(),
      };
    }
    return { status: "loading", data: null, error: null, refresh: vi.fn() };
  };
}

beforeEach(() => {
  cleanup();
  useAdminDataMock.mockReset();
  useAdminDataMock.mockImplementation(makeImpl({ kind: "ok" }));
  useAdminAuthMock.mockReturnValue({
    status: "ready",
    whoami: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "admin@finsight.app",
      role: "admin",
      permissions: ["REPORT_VIEW", "AUDIT_LOG_VIEW"],
    },
  });
});

describe("dashboard recent administrative activity", () => {
  it("requests exactly the latest five records and renders them newest-first", () => {
    render(<AdminDashboard />);
    const calls = useAdminDataMock.mock.calls.map((c) => c[0]);
    expect(calls).toContain(ACTIVITY_PATH);

    expect(screen.getByText("Recent administrative activity")).toBeInTheDocument();
    expect(screen.getAllByText("user.suspend")).toHaveLength(5);

    // Newest-first: user5's row appears before user1's in document order.
    const newest = screen.getByText("user5@example.com");
    const oldest = screen.getByText("user1@example.com");
    expect(newest.compareDocumentPosition(oldest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("links to the full audit log", () => {
    render(<AdminDashboard />);
    expect(screen.getByRole("link", { name: /view all audit activity/i })).toHaveAttribute("href", "/admin/audit");
  });

  it("does not fetch or render audit data without REPORT_VIEW", () => {
    useAdminAuthMock.mockReturnValue({
      status: "ready",
      whoami: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "limited@finsight.app",
        role: "admin",
        permissions: ["AUDIT_LOG_VIEW"], // can read the audit page directly, but not reports
      },
    });
    render(<AdminDashboard />);
    expect(screen.getByText(/report access required/i)).toBeInTheDocument();
    const calls = useAdminDataMock.mock.calls.map((c) => c[0]);
    expect(calls.filter((p) => typeof p === "string" && p.startsWith("/audit-logs"))).toHaveLength(0);
    expect(screen.queryByText("Recent administrative activity")).not.toBeInTheDocument();
  });

  it("keeps every other dashboard card alive when the activity query fails", () => {
    useAdminDataMock.mockImplementation(makeImpl({ kind: "error" }));
    render(<AdminDashboard />);
    // Stats survive…
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("System health")).toBeInTheDocument();
    expect(screen.getByText("Account status")).toBeInTheDocument();
    // …and the failed card is absent entirely — no broken state anywhere.
    expect(screen.queryByText("Recent administrative activity")).not.toBeInTheDocument();
    expect(screen.queryByText(/audit store down/)).not.toBeInTheDocument();
  });

  it("renders a loading skeleton while the activity query resolves", () => {
    useAdminDataMock.mockReset();
    useAdminDataMock.mockImplementation(makeImpl({ kind: "loading" }));
    render(<AdminDashboard />);
    expect(screen.getByText("Users")).toBeInTheDocument(); // other cards fine
    expect(screen.getByText("Recent administrative activity")).toBeInTheDocument();
    expect(screen.queryByText("user.suspend")).not.toBeInTheDocument();
  });

  it("renders an explicit empty state when no administrative action exists yet", () => {
    useAdminDataMock.mockImplementation(makeImpl({ kind: "ok", items: [] }));
    render(<AdminDashboard />);
    expect(screen.getByText("No administrative activity yet")).toBeInTheDocument();
  });
});
