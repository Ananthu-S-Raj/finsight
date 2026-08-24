// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { useAdminDataMock, useAdminAuthMock, adminFetchMock, toastMocks, downloadCsvMock, currentSearch } = vi.hoisted(() => ({
  useAdminDataMock: vi.fn(),
  useAdminAuthMock: vi.fn(),
  adminFetchMock: vi.fn(),
  toastMocks: { success: vi.fn(), error: vi.fn() },
  downloadCsvMock: vi.fn(),
  currentSearch: { value: "" },
}));

vi.mock("@/lib/admin/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/admin/client")>();
  return {
    ...original,
    useAdminAuth: useAdminAuthMock,
    adminFetch: (...args: unknown[]) => adminFetchMock(...(args as [])),
  };
});
vi.mock("@/lib/csv", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/csv")>();
  return { ...original, downloadCsv: (...args: unknown[]) => downloadCsvMock(...(args as [])) };
});
vi.mock("@/lib/admin/useAdminData", () => ({ useAdminData: useAdminDataMock }));
vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ success: toastMocks.success, error: toastMocks.error }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(currentSearch.value),
}));
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { signOut: vi.fn(async () => ({})) } },
}));

import AdminUsersPage from "@/app/admin/users/page";
import AdminAuditPage from "@/app/admin/audit/page";
import AdminTransactionsPage from "@/app/admin/transactions/page";

/**
 * Client-side CSV export (G-07 companion): each console list can export its
 * CURRENTLY FILTERED dataset. The export re-fetches through the authorized
 * API preserving every active filter but pinning pageSize=100 and walking
 * pages up to an explicit safety cap before handing the rows to the shared
 * CSV builder.
 */

const ALL_PERMS = ["USER_VIEW", "ROLE_MANAGE", "USER_SUSPEND", "REPORT_VIEW", "TRANSACTION_VIEW"];

function userRow(id: string) {
  return {
    id,
    email: `${id}@x.io`,
    full_name: `User ${id}`,
    role: "user",
    account_status: "active",
    monthly_budget: 0,
    created_at: "2026-02-03T04:05:06Z",
    last_login_at: null,
    last_active_at: null,
    email_confirmed_at: null,
  };
}

function paged(items: unknown[], total: number, page = 1, pageSize = 15, pages?: number) {
  return {
    status: "ready" as const,
    data: { items, total, page, pageSize, pages: pages ?? Math.max(1, Math.ceil(total / pageSize)) },
    error: null,
    refresh: vi.fn(),
  };
}

function fetchedPaths(): string[] {
  return adminFetchMock.mock.calls.map((c) => c[0] as string);
}

beforeEach(() => {
  cleanup();
  currentSearch.value = "";
  useAdminDataMock.mockReset();
  adminFetchMock.mockReset();
  toastMocks.success.mockReset();
  toastMocks.error.mockReset();
  downloadCsvMock.mockReset();
  useAdminDataMock.mockImplementation(() => paged([userRow("u1")], 1));
  adminFetchMock.mockImplementation(() => Promise.resolve({ items: [], total: 0, page: 1, pageSize: 100, pages: 1 }));
  useAdminAuthMock.mockReturnValue({
    status: "ready",
    whoami: { id: "u1", email: "admin@finsight.app", role: "admin", permissions: ALL_PERMS },
  });
});

describe("users CSV export", () => {
  it("exports every filtered page at pageSize=100 and preserves active filters", async () => {
    render(<AdminUsersPage />);
    fireEvent.change(screen.getByLabelText(/filter by role/i), { target: { value: "user" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /unverified only/i }));
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    await waitFor(() => expect(adminFetchMock).toHaveBeenCalled());
    // The live-table request keeps pageSize=15; export walks its own pages.
    expect(fetchedPaths().some((p) => p.includes("pageSize=100"))).toBe(true);
    for (const p of fetchedPaths().filter((p) => p.includes("pageSize=100"))) {
      expect(p).toContain("/users?");
      expect(p).toContain("role=user");
      expect(p).toContain("verified=false");
      expect(p).not.toContain("pageSize=15");
    }
  });

  it("walks multiple pages until the filtered total is covered", async () => {
    let call = 0;
    adminFetchMock.mockImplementation(() => {
      call += 1;
      return Promise.resolve({ items: [userRow(`u${call}`)], total: 250, page: call, pageSize: 100, pages: 3 });
    });
    render(<AdminUsersPage />);
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    await waitFor(() => expect(downloadCsvMock).toHaveBeenCalled());
    expect(fetchedPaths().filter((p) => p.includes("pageSize=100")).map((p) => Number(new URLSearchParams(p.split("?")[1]).get("page")))).toEqual([1, 2, 3]);
    expect(downloadCsvMock.mock.calls[0][0]).toMatch(/^admin-users-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = downloadCsvMock.mock.calls[0][1] as string;
    expect(csv.slice(1).split("\r\n")[0]).toBe(
      ["ID", "Name", "Email", "Role", "Status", "Email Verified", "Created At"].join(",")
    );
    expect(csv).toContain("u3@x.io");
  });

  it("disables the button while an export is in flight", async () => {
    let release!: () => void;
    adminFetchMock.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ items: [], total: 0, page: 1, pageSize: 100, pages: 1 }); }));
    render(<AdminUsersPage />);
    const btn = screen.getByRole("button", { name: /export csv/i });
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    release();
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("hides the export control without USER_VIEW", () => {
    useAdminAuthMock.mockReturnValue({
      status: "ready",
      whoami: { id: "u1", email: "x@x.io", role: "admin", permissions: ["REPORT_VIEW"] },
    });
    render(<AdminUsersPage />);
    expect(screen.queryByRole("button", { name: /export csv/i })).not.toBeInTheDocument();
  });

  it("surfaces failures as a toast instead of throwing", async () => {
    adminFetchMock.mockRejectedValue(new Error("boom"));
    render(<AdminUsersPage />);
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled());
    expect(downloadCsvMock).not.toHaveBeenCalled();
  });
});

describe("audit CSV export", () => {
  const entry = {
    id: "00000000-0000-4000-8000-00000000a001",
    actor_id: "u1",
    actor_email: "admin@finsight.app",
    action: "user.suspend",
    resource_type: "user",
    resource_id: "u2",
    target_user_id: "u2",
    target_email: "b@x.io",
    metadata: { reason: "=HYPERLINK(evil)" },
    ip: "127.0.0.1",
    user_agent: null,
    result: "success",
    reason: "spam",
    created_at: "2026-03-04T05:06:07Z",
  };

  function auditState() {
    return {
      status: "ready" as const,
      data: { items: [entry], total: 1, page: 1, pageSize: 25, pages: 1 },
      error: null,
      refresh: vi.fn(),
    };
  }

  it("exports the filtered audit log with metadata serialized safely", async () => {
    useAdminDataMock.mockImplementation(auditState);
    adminFetchMock.mockResolvedValue({ items: [entry], total: 1, page: 1, pageSize: 100, pages: 1 });
    render(<AdminAuditPage />);
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    await waitFor(() => expect(downloadCsvMock).toHaveBeenCalled());
    expect(downloadCsvMock.mock.calls[0][0]).toMatch(/^admin-audit-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = downloadCsvMock.mock.calls[0][1] as string;
    expect(csv.slice(1).split("\r\n")[0]).toBe(
      ["Timestamp", "Action", "Actor", "Target User", "Resource Type", "Resource ID", "Reason", "Metadata"].join(",")
    );
    const dataLine = csv.slice(1).split("\r\n")[1];
    // Metadata is serialized as JSON; the embedded formula payload stays
    // safely inside a quoted, quote-doubled cell.
    expect(dataLine).toContain('"{""reason"":""=HYPERLINK(evil)""}"');
    expect(dataLine).toContain("user.suspend");
  });

  it("preserves the active action filter in export requests", async () => {
    useAdminDataMock.mockImplementation(auditState);
    render(<AdminAuditPage />);
    fireEvent.change(screen.getByLabelText(/action filter/i), { target: { value: "user.suspend" } });
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    await waitFor(() => expect(adminFetchMock).toHaveBeenCalled());
    const exportPath = fetchedPaths().find((p) => p.includes("pageSize=100"));
    expect(exportPath).toContain("/audit-logs?");
    expect(exportPath).toContain("action=user.suspend");
  });
});

describe("transactions CSV export", () => {
  const tx = {
    id: "00000000-0000-4000-8000-00000000t001",
    user_id: "u1",
    user: { id: "u1", email: "a@x.io", full_name: "User u1" },
    type: "expense",
    category: "Food",
    subcategory: "Groceries",
    amount: -12.5,
    overspend_amount: 0,
    note: 'note with, comma',
    flagged: true,
    flag_reason: "check amount",
    created_at: "2026-04-05T06:07:08Z",
  };

  it("exports displayed transaction fields with proper escaping", async () => {
    const malicious = { ...tx, id: "00000000-0000-4000-8000-00000000t002", note: "=SUM(A1:A9)" };
    useAdminDataMock.mockImplementation(() => ({
      status: "ready",
      data: { items: [tx, malicious], total: 2, page: 1, pageSize: 15, pages: 1 },
      error: null,
      refresh: vi.fn(),
    }));
    adminFetchMock.mockResolvedValue({ items: [tx, malicious], total: 2, page: 1, pageSize: 100, pages: 1 });
    render(<AdminTransactionsPage />);
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    await waitFor(() => expect(downloadCsvMock).toHaveBeenCalled());
    expect(downloadCsvMock.mock.calls[0][0]).toMatch(/^admin-transactions-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = downloadCsvMock.mock.calls[0][1] as string;
    expect(csv.slice(1).split("\r\n")[0]).toBe(
      ["Date", "User", "Email", "Type", "Category", "Subcategory", "Amount", "Note", "Flagged", "Flag Reason"].join(",")
    );
    expect(csv).toContain('"note with, comma"');
    expect(csv).toContain("-12.5");
    expect(csv).toContain("true");
    // A note that could be read as a spreadsheet formula is neutralised.
    expect(csv).toContain("'=SUM(A1:A9)");
  });

  it("keeps the userId deep-link filter in export requests", async () => {
    currentSearch.value = "userId=u9";
    useAdminDataMock.mockImplementation(() => ({
      status: "ready",
      data: { items: [tx], total: 1, page: 1, pageSize: 15, pages: 1 },
      error: null,
      refresh: vi.fn(),
    }));
    adminFetchMock.mockResolvedValue({ items: [tx], total: 1, page: 1, pageSize: 100, pages: 1 });
    render(<AdminTransactionsPage />);
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    await waitFor(() => expect(adminFetchMock).toHaveBeenCalled());
    const exportPath = fetchedPaths().find((p) => p.includes("pageSize=100"));
    expect(exportPath).toContain("/transactions?");
    expect(exportPath).toContain("userId=u9");
  });
});
