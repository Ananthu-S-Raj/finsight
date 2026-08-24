// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { useAdminDataMock, useAdminAuthMock, adminFetchMock, toastMocks } = vi.hoisted(() => ({
  useAdminDataMock: vi.fn(),
  useAdminAuthMock: vi.fn(),
  adminFetchMock: vi.fn(),
  toastMocks: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/admin/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/admin/client")>();
  return {
    ...original,
    useAdminAuth: useAdminAuthMock,
    adminFetch: (...args: unknown[]) => adminFetchMock(...(args as [])),
  };
});
vi.mock("@/lib/admin/useAdminData", () => ({ useAdminData: useAdminDataMock }));
vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ success: toastMocks.success, error: toastMocks.error }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/admin/transactions",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { signOut: vi.fn(async () => ({})) } },
}));

import AdminTransactionsPage from "@/app/admin/transactions/page";

const TX_ID = "00000000-0000-4000-8000-000000000010";
const USER_ID = "00000000-0000-4000-8000-000000000003";

function flaggedTx() {
  return {
    id: TX_ID,
    user_id: USER_ID,
    user: { id: USER_ID, email: "user@example.com", full_name: "Jane User" },
    type: "expense",
    category: "Food",
    subcategory: null,
    amount: 120,
    overspend_amount: 0,
    note: "lunch",
    flagged: true,
    flag_reason: "Possible duplicate",
    created_at: "2026-08-01T10:00:00Z",
  };
}

beforeEach(() => {
  cleanup();
  adminFetchMock.mockReset();
  toastMocks.success.mockReset();
  toastMocks.error.mockReset();
  useAdminAuthMock.mockReturnValue({
    status: "ready",
    whoami: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "admin@finsight.app",
      role: "admin",
      permissions: ["TRANSACTION_VIEW", "TRANSACTION_EDIT"],
    },
  });
  useAdminDataMock.mockReturnValue({
    status: "ready",
    data: { items: [flaggedTx()], total: 1, page: 1, pages: 1 },
    error: null,
    refresh: vi.fn(),
  });
});

describe("transaction unflag UI", () => {
  it("shows the Remove flag action only for flagged rows under TRANSACTION_EDIT", () => {
    render(<AdminTransactionsPage />);
    expect(screen.getByTitle("Remove flag")).toBeInTheDocument();
    expect(screen.queryByTitle("Flag for review")).not.toBeInTheDocument();
  });

  it("hides moderation actions without TRANSACTION_EDIT", () => {
    useAdminAuthMock.mockReturnValue({
      status: "ready",
      whoami: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "viewer@finsight.app",
        role: "admin",
        permissions: ["TRANSACTION_VIEW"],
      },
    });
    render(<AdminTransactionsPage />);
    expect(screen.queryByTitle("Remove flag")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Correct transaction")).not.toBeInTheDocument();
  });

  it("sends POST /transactions/:id/unflag and reports success", async () => {
    const refresh = vi.fn();
    useAdminDataMock.mockReturnValue({
      status: "ready",
      data: { items: [flaggedTx()], total: 1, page: 1, pages: 1 },
      error: null,
      refresh,
    });
    adminFetchMock.mockResolvedValue({ id: TX_ID, flagged: false });

    render(<AdminTransactionsPage />);
    fireEvent.click(screen.getByTitle("Remove flag"));

    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Remove flag" });
    // ConfirmDialog is arm-then-fire: the first click arms, the second fires.
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(adminFetchMock).toHaveBeenCalledOnce());
    expect(adminFetchMock).toHaveBeenCalledWith(`/transactions/${TX_ID}/unflag`, { method: "POST" });
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalledWith("Flag removed."));
    expect(refresh).toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("surfaces API failures through the error toast and keeps the row", async () => {
    const refresh = vi.fn();
    useAdminDataMock.mockReturnValue({
      status: "ready",
      data: { items: [flaggedTx()], total: 1, page: 1, pages: 1 },
      error: null,
      refresh,
    });
    adminFetchMock.mockRejectedValue(new Error("audit_failed"));

    render(<AdminTransactionsPage />);
    fireEvent.click(screen.getByTitle("Remove flag"));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Remove flag" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledWith("audit_failed"));
    expect(toastMocks.success).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    // Row still rendered — nothing was optimistically removed.
    expect(screen.getByText("Possible duplicate")).toBeInTheDocument();
  });

  it("does not call the API when the confirmation is dismissed", async () => {
    render(<AdminTransactionsPage />);
    fireEvent.click(screen.getByTitle("Remove flag"));
    const dialog = await screen.findByRole("dialog");
    const cancel = Array.from(dialog.querySelectorAll("button")).find((b) =>
      /cancel|close|dismiss/i.test(b.textContent ?? "")
    );
    if (cancel) fireEvent.click(cancel);
    expect(adminFetchMock).not.toHaveBeenCalled();
  });
});
