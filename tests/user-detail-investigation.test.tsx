// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const ID = "00000000-0000-4000-8000-000000000003";
const TX_VIEW_PATH = `/admin/transactions?userId=${ID}`;

const { useRouterPush, useAdminDataMock, useAdminAuthMock } = vi.hoisted(() => ({
  useRouterPush: vi.fn(),
  useAdminDataMock: vi.fn(),
  useAdminAuthMock: vi.fn(),
}));

vi.mock("@/lib/admin/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/admin/client")>();
  return { ...original, useAdminAuth: useAdminAuthMock };
});
vi.mock("@/lib/admin/useAdminData", () => ({ useAdminData: useAdminDataMock }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "00000000-0000-4000-8000-000000000003" }),
  useRouter: () => ({ push: useRouterPush }),
  usePathname: () => "/admin/users/00000000-0000-4000-8000-000000000003",
}));
vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { signOut: vi.fn(async () => ({})) } },
}));

import AdminUserDetailPage from "@/app/admin/users/[id]/page";

const AUDIT_ROW = {
  id: "a1",
  actor_id: "00000000-0000-4000-8000-000000000001",
  actor_email: "admin@finsight.app",
  action: "user.suspend",
  resource_type: "user",
  resource_id: ID,
  target_user_id: ID,
  target_email: "user@example.com",
  metadata: {},
  ip: null,
  user_agent: null,
  result: "success",
  reason: null,
  created_at: "2026-08-20T10:00:00Z",
};

function userDetailFixture() {
  return {
    id: ID,
    email: "user@example.com",
    full_name: "Jane User",
    role: "user",
    account_status: "active",
    monthly_budget: 500,
    created_at: "2026-01-03T00:00:00Z",
    last_login_at: null,
    last_active_at: "2026-08-01T00:00:00Z",
    email_confirmed_at: "2026-01-03T00:00:00Z",
    last_sign_in_at: "2026-08-01T00:00:00Z",
    salary_balance: 1000,
    savings_balance: 250,
    auth_created_at: "2026-01-03T00:00:00Z",
    transaction_count: 12,
    push_count: 1,
  };
}

function pagedAudit(items: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    data: { items, total: items.length, page: 1, pageSize: 5, pages: 1, ...overrides },
    error: null,
    refresh: vi.fn(),
  };
}

function defaultPermissions(): string[] {
  return [
    "USER_VIEW", "USER_EDIT", "USER_SUSPEND", "ROLE_MANAGE",
    "AUDIT_LOG_VIEW", "TRANSACTION_VIEW", "REPORT_VIEW",
  ];
}

beforeEach(() => {
  cleanup();
  useRouterPush.mockReset();
  useAdminDataMock.mockReset();
  useAdminDataMock.mockImplementation((path: string | null) => {
    if (path && path.startsWith("/users/")) {
      return { status: "ready", data: userDetailFixture(), error: null, refresh: vi.fn() };
    }
    if (path && path.startsWith("/audit-logs")) {
      return pagedAudit([AUDIT_ROW]);
    }
    return { status: "ready", data: {}, error: null, refresh: vi.fn() };
  });
  useAdminAuthMock.mockReset();
  useAdminAuthMock.mockReturnValue({
    status: "ready",
    whoami: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "admin@finsight.app",
      role: "admin",
      permissions: defaultPermissions(),
    },
  });
});

describe("user detail investigation surfaces", () => {
  it("renders the audit history section and queries the shared audit API by target user", () => {
    render(<AdminUserDetailPage />);
    expect(screen.getByText("Audit history")).toBeInTheDocument();

    const auditCall = useAdminDataMock.mock.calls
      .map((c) => c[0] as string | null)
      .find((p) => typeof p === "string" && p.startsWith("/audit-logs"));
    expect(auditCall).toBe(`/audit-logs?userId=${encodeURIComponent(ID)}&page=1&pageSize=5`);

    expect(screen.getByText("user.suspend")).toBeInTheDocument();
    expect(screen.getByText(/admin@finsight\.app/)).toBeInTheDocument();
    expect(screen.getByText(/user: 00000000…/)).toBeInTheDocument();
  });

  it("hides the audit history section and skips its query without AUDIT_LOG_VIEW", () => {
    useAdminAuthMock.mockReturnValue({
      status: "ready",
      whoami: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "admin@finsight.app",
        role: "admin",
        permissions: ["USER_VIEW", "USER_EDIT"],
      },
    });
    render(<AdminUserDetailPage />);
    expect(screen.queryByText("Audit history")).not.toBeInTheDocument();
    const auditCalls = useAdminDataMock.mock.calls
      .map((c) => c[0] as string | null)
      .filter((p) => typeof p === "string" && p.startsWith("/audit-logs"));
    expect(auditCalls).toHaveLength(0);
  });

  it("shows empty, loading and error states for the audit query", () => {
    useAdminDataMock.mockImplementation((path: string | null) =>
      path && path.startsWith("/users/")
        ? { status: "ready", data: userDetailFixture(), error: null, refresh: vi.fn() }
        : pagedAudit([])
    );
    const empty = render(<AdminUserDetailPage />);
    expect(screen.getByText("No administrative activity")).toBeInTheDocument();
    empty.unmount();

    useAdminDataMock.mockImplementation((path: string | null) =>
      path && path.startsWith("/users/")
        ? { status: "ready", data: userDetailFixture(), error: null, refresh: vi.fn() }
        : { status: "loading", data: null, error: null, refresh: vi.fn() }
    );
    const loading = render(<AdminUserDetailPage />);
    expect(screen.getByText("Audit history")).toBeInTheDocument();
    loading.unmount();

    useAdminDataMock.mockImplementation((path: string | null) =>
      path && path.startsWith("/users/")
        ? { status: "ready", data: userDetailFixture(), error: null, refresh: vi.fn() }
        : { status: "error", data: null, error: { message: "db down" }, refresh: vi.fn() }
    );
    render(<AdminUserDetailPage />);
    expect(screen.getByText("Could not load audit history")).toBeInTheDocument();
    expect(screen.getByText(/db down/)).toBeInTheDocument();
  });

  it("paginates through the audit history via the shared Pagination pattern", () => {
    useAdminDataMock.mockImplementation((path: string | null) => {
      if (path && path.startsWith("/users/")) {
        return { status: "ready", data: userDetailFixture(), error: null, refresh: vi.fn() };
      }
      if (path && path.includes("page=2")) return pagedAudit([{ ...AUDIT_ROW, id: "a2", action: "user.update" }]);
      return pagedAudit([AUDIT_ROW], { pages: 2, total: 8 });
    });
    render(<AdminUserDetailPage />);
    const next = screen.getByRole("button", { name: /next/i });
    fireEvent.click(next);
    const call = useAdminDataMock.mock.calls
      .map((c) => c[0] as string | null)
      .filter((p): p is string => typeof p === "string" && p.startsWith("/audit-logs"))
      .at(-1);
    expect(call).toContain("page=2");
  });

  it("deep-links transactions investigation into the existing page filter", () => {
    render(<AdminUserDetailPage />);
    const btn = screen.getByRole("button", { name: /view transactions/i });
    fireEvent.click(btn);
    expect(useRouterPush).toHaveBeenCalledWith(TX_VIEW_PATH);
  });

  it("hides the transactions link without TRANSACTION_VIEW", () => {
    useAdminAuthMock.mockReturnValue({
      status: "ready",
      whoami: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "admin@finsight.app",
        role: "admin",
        permissions: ["USER_VIEW", "AUDIT_LOG_VIEW"],
      },
    });
    render(<AdminUserDetailPage />);
    expect(screen.queryByRole("button", { name: /view transactions/i })).not.toBeInTheDocument();
  });

  it("links 'View all audit activity' with the target pre-populated", () => {
    render(<AdminUserDetailPage />);
    const link = screen.getByRole("link", { name: /view all audit activity/i });
    expect(link).toHaveAttribute("href", `/admin/audit?userId=${encodeURIComponent(ID)}`);
  });

  it("keeps existing administrative actions intact alongside the new surfaces", () => {
    render(<AdminUserDetailPage />);
    expect(screen.getByRole("button", { name: /revoke sessions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send password reset/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back to users/i })).toBeInTheDocument();
    expect(screen.getByText("Financial snapshot")).toBeInTheDocument();
    expect(screen.getByText("Salary balance")).toBeInTheDocument();
  });
});
