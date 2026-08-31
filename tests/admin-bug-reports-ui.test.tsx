// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { useAdminDataMock, useAdminAuthMock, toastMocks, adminFetchMock, refreshMock } = vi.hoisted(() => ({
  useAdminDataMock: vi.fn(),
  useAdminAuthMock: vi.fn(),
  toastMocks: { success: vi.fn(), error: vi.fn() },
  adminFetchMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/admin/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/admin/client")>();
  return { ...original, useAdminAuth: useAdminAuthMock, adminFetch: adminFetchMock };
});
vi.mock("@/lib/admin/useAdminData", () => ({ useAdminData: useAdminDataMock }));
vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ success: toastMocks.success, error: toastMocks.error }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/admin/bug-reports",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { signOut: vi.fn(async () => ({})) } },
}));

import AdminBugReportsPage from "@/app/admin/bug-reports/page";

const REPORT_ID = "00000000-0000-4000-8000-000000000010";

function adminBugReport(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    user_id: "00000000-0000-4000-8000-000000000003",
    title: "Dashboard freezes",
    description: "It freezes whenever I open the overview.",
    category: "bug",
    severity: "high",
    steps_to_reproduce: "Open the overview tab.",
    expected_behavior: "It loads instantly.",
    actual_behavior: "It freezes for a minute.",
    page_url: "https://app.finsight.io/overview",
    user_agent: "Chrome 126 on Windows",
    status: "open",
    admin_notes: null,
    created_at: "2026-09-02T10:00:00Z",
    updated_at: "2026-09-02T10:00:00Z",
    user: { id: "00000000-0000-4000-8000-000000000003", email: "user1@example.com", full_name: "User One" },
    ...overrides,
  };
}

function ready(items: unknown[], total = items.length) {
  return {
    status: "ready",
    data: { items, total, page: 1, pages: 1, pageSize: 15 },
    error: null,
    refresh: refreshMock,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAdminAuthMock.mockReturnValue({
    status: "authenticated",
    whoami: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "admin@finsight.app",
      role: "admin",
      permissions: ["BUG_REPORT_MANAGE"],
    },
  });
  adminFetchMock.mockResolvedValue({});
});

describe("admin bug reports page", () => {
  it("fetches the first page and renders the triage table", () => {
    useAdminDataMock.mockReturnValue(ready([adminBugReport()]));
    render(<AdminBugReportsPage />);

    const query = useAdminDataMock.mock.calls.at(-1)?.[0] as string;
    expect(query).toBe("/bug-reports?page=1&pageSize=15");

    expect(screen.getByText("User One")).toBeInTheDocument();
    expect(screen.getByText("user1@example.com")).toBeInTheDocument();
    expect(screen.getByText("Dashboard freezes")).toBeInTheDocument();
    // "Bug" appears in the table cell and also in the category filter option.
    expect(screen.getAllByText("Bug").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
  });

  it("supports status, category and search filters against the query", async () => {
    useAdminDataMock.mockReturnValue(ready([]));
    render(<AdminBugReportsPage />);

    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "in_progress" } });
    let query = useAdminDataMock.mock.calls.at(-1)?.[0] as string;
    expect(query).toContain("status=in_progress");

    fireEvent.change(screen.getByLabelText("Category filter"), { target: { value: "performance" } });
    query = useAdminDataMock.mock.calls.at(-1)?.[0] as string;
    expect(query).toContain("status=in_progress");
    expect(query).toContain("category=performance");

    // SearchInput debounces 300ms; use real timers + waitFor.
    fireEvent.change(screen.getByPlaceholderText("Search title or description…"), {
      target: { value: "freezes" },
    });
    await waitFor(
      () => {
        const q = useAdminDataMock.mock.calls.at(-1)?.[0] as string;
        expect(q).toContain("search=freezes");
      },
      { timeout: 2000 }
    );
  });

  it("resets the filters back to the unfiltered first page", () => {
    useAdminDataMock.mockReturnValue(ready([]));
    render(<AdminBugReportsPage />);

    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "resolved" } });
    const reset = screen.getByRole("button", { name: "Reset filters" });
    fireEvent.click(reset);

    const query = useAdminDataMock.mock.calls.at(-1)?.[0] as string;
    expect(query).toBe("/bug-reports?page=1&pageSize=15");
    expect(screen.queryByRole("button", { name: "Reset filters" })).not.toBeInTheDocument();
  });

  it("shows the empty state for a filter with no matches", () => {
    useAdminDataMock.mockReturnValue(ready([]));
    render(<AdminBugReportsPage />);
    expect(screen.getByText("No bug reports match")).toBeInTheDocument();
  });

  it("surfaces load errors", () => {
    useAdminDataMock.mockReturnValue({
      status: "error",
      data: null,
      error: { status: 502, message: "Could not load bug reports.", code: "db_error" },
      refresh: refreshMock,
    });
    render(<AdminBugReportsPage />);
    expect(screen.getByText("Could not load bug reports")).toBeInTheDocument();
  });

  it("opens the detail dialog and saves status + notes via a PATCH", async () => {
    useAdminDataMock.mockReturnValue(ready([adminBugReport()]));
    render(<AdminBugReportsPage />);

    fireEvent.click(screen.getByText("Dashboard freezes"));

    const dialog = screen.getByRole("dialog", { name: "Bug report: Dashboard freezes" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("It freezes whenever I open the overview.")).toBeInTheDocument();
    expect(within(dialog).getByText("Open the overview tab.")).toBeInTheDocument();
    expect(within(dialog).getByText(/Chrome 126 on Windows/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Report status"), { target: { value: "resolved" } });
    fireEvent.change(screen.getByPlaceholderText("Internal notes (visible to admins only)"), {
      target: { value: "  Fixed in v2.3.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(adminFetchMock).toHaveBeenCalledWith(`/bug-reports/${REPORT_ID}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "resolved", admin_notes: "Fixed in v2.3." }),
      });
      expect(toastMocks.success).toHaveBeenCalledWith("Bug report updated.");
      expect(refreshMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cancelling the dialog leaves the list untouched", () => {
    useAdminDataMock.mockReturnValue(ready([adminBugReport()]));
    render(<AdminBugReportsPage />);

    fireEvent.click(screen.getByText("User One"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(adminFetchMock).not.toHaveBeenCalled();
  });

  it("toasts an error when the PATCH fails", async () => {
    useAdminDataMock.mockReturnValue(ready([adminBugReport()]));
    adminFetchMock.mockRejectedValueOnce(new Error("Could not update the bug report."));
    render(<AdminBugReportsPage />);

    fireEvent.click(screen.getByText("Dashboard freezes"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalledWith("Could not update the bug report.");
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});