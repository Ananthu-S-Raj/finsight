// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import AdminUserDetailPage from "@/app/admin/users/[id]/page";

const TARGET_ID = "00000000-0000-4000-8000-000000000003";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/users/x",
  useParams: () => ({ id: TARGET_ID }),
}));
vi.mock("@/lib/haptics", () => ({ haptic: vi.fn() }));
vi.mock("@/lib/hooks", () => ({
  useMediaQuery: (query: string) => query.includes("min-width"),
}));
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { signOut: vi.fn(async () => ({})) } },
}));

const { adminFetch, refresh } = vi.hoisted(() => ({
  adminFetch: vi.fn(),
  refresh: vi.fn(),
}));

const { useAdminAuthMock, useAdminDataMock, toastSuccess, toastError } = vi.hoisted(() => ({
  useAdminAuthMock: vi.fn(),
  useAdminDataMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/admin/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/admin/client")>();
  return {
    ...original,
    useAdminAuth: useAdminAuthMock,
    adminFetch,
  };
});
vi.mock("@/lib/admin/useAdminData", () => ({
  useAdminData: useAdminDataMock,
}));
vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn(), warning: vi.fn() }),
}));

function userFixture() {
  return {
    id: TARGET_ID,
    email: "user@example.com",
    full_name: "Jane User",
    role: "user",
    account_status: "active",
    monthly_budget: 0,
    salary_balance: 0,
    savings_balance: 0,
    created_at: "2026-01-03T00:00:00Z",
    last_login_at: null,
    last_active_at: null,
    email_confirmed_at: "2026-01-03T00:00:00Z",
    auth_created_at: "2026-01-03T00:00:00Z",
    last_sign_in_at: "2026-08-01T00:00:00Z",
    transaction_count: 0,
    push_count: 0,
  };
}

function mockState(permissions: string[], status = "active") {
  useAdminAuthMock.mockReturnValue({
    status: "ready",
    whoami: { id: "a1", email: "admin@finsight.app", role: "admin", permissions },
  });
  useAdminDataMock.mockReturnValue({
    status: "ready",
    data: { ...userFixture(), account_status: status },
    refresh,
  });
}

/**
 * Opens a lifecycle action's ConfirmDialog and completes its arm-then-fire
 * confirmation (no typed text -> two clicks, waiting for the arm re-render
 * between them, exactly like two real user clicks).
 */
async function openAndConfirm(actionButtonName: RegExp, label: string) {
  fireEvent.click(screen.getByRole("button", { name: actionButtonName }));
  const dialog = await screen.findByRole("dialog");
  const getConfirm = () => within(dialog).getByRole("button", { name: new RegExp(`^${label}`) });
  fireEvent.click(getConfirm()); // arm — label gains "— tap again", button enables
  await waitFor(() => expect(within(dialog).getByRole("button", { name: `${label} — tap again` })).toBeEnabled());
  fireEvent.click(getConfirm()); // fire
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("admin user lifecycle action gating", () => {
  it("shows revoke + password-reset controls with the right permissions", () => {
    mockState(["USER_VIEW", "USER_SUSPEND", "USER_EDIT"]);
    render(<AdminUserDetailPage />);

    expect(screen.getByRole("button", { name: /Revoke sessions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send password reset/i })).toBeInTheDocument();
  });

  it("hides the revoke control without USER_SUSPEND", () => {
    mockState(["USER_VIEW", "USER_EDIT"]);
    render(<AdminUserDetailPage />);

    expect(screen.queryByRole("button", { name: /Revoke sessions/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send password reset/i })).toBeInTheDocument();
  });

  it("hides the password-reset control without USER_EDIT", () => {
    mockState(["USER_VIEW", "USER_SUSPEND"]);
    render(<AdminUserDetailPage />);

    expect(screen.getByRole("button", { name: /Revoke sessions/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send password reset/i })).not.toBeInTheDocument();
  });
});

describe("revoke sessions flow", () => {
  it("calls the session-revoke endpoint after confirmation", async () => {
    mockState(["USER_VIEW", "USER_SUSPEND", "USER_EDIT"]);
    adminFetch.mockResolvedValue({ id: TARGET_ID, sessions_revoked: true });
    render(<AdminUserDetailPage />);

    await openAndConfirm(/^Revoke sessions$/, "Revoke sessions");

    await waitFor(() =>
      expect(adminFetch).toHaveBeenCalledWith(`/users/${TARGET_ID}/sessions/revoke`, { method: "POST" })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it("does not report success when the operation fails", async () => {
    mockState(["USER_VIEW", "USER_SUSPEND", "USER_EDIT"]);
    adminFetch.mockRejectedValue(new Error("Could not revoke the user's sessions."));
    render(<AdminUserDetailPage />);

    await openAndConfirm(/^Revoke sessions$/, "Revoke sessions");

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    // No stale success state: the action button becomes available again.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Revoke sessions$/ })).toBeEnabled()
    );
  });
});

describe("opt-in session revocation on status changes", () => {
  it("revokes alongside a suspend when the checkbox is checked", async () => {
    mockState(["USER_VIEW", "USER_SUSPEND", "USER_EDIT"]);
    adminFetch.mockResolvedValue({});
    render(<AdminUserDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: /Suspend account/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByLabelText(/Also revoke active sessions/i));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Suspend$/ }));
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Suspend — tap again" })).toBeEnabled()
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /^Suspend/ }));

    await waitFor(() =>
      expect(adminFetch).toHaveBeenCalledWith(`/users/${TARGET_ID}`, {
        method: "PATCH",
        body: JSON.stringify({ account_status: "suspended" }),
      })
    );
    await waitFor(() =>
      expect(adminFetch).toHaveBeenCalledWith(`/users/${TARGET_ID}/sessions/revoke`, { method: "POST" })
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("skips revocation when the checkbox stays unchecked", async () => {
    mockState(["USER_VIEW", "USER_SUSPEND", "USER_EDIT"]);
    adminFetch.mockResolvedValue({});
    render(<AdminUserDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: /Suspend account/i }));
    const dialog = await screen.findByRole("dialog");

    const confirm = within(dialog).getByRole("button", { name: /^Suspend$/ });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Suspend — tap again" })).toBeEnabled()
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /^Suspend/ }));

    await waitFor(() => expect(adminFetch).toHaveBeenCalledTimes(1));
    expect(adminFetch).toHaveBeenCalledWith(`/users/${TARGET_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ account_status: "suspended" }),
    });
  });

  it("reports a partial failure clearly when only the revocation fails", async () => {
    mockState(["USER_VIEW", "USER_SUSPEND", "USER_EDIT"]);
    adminFetch.mockImplementation(async (_path: string, init?: { method?: string }) => {
      if (init?.method === "PATCH") return {};
      throw new Error("Could not revoke the user's sessions.");
    });
    render(<AdminUserDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: /Suspend account/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByLabelText(/Also revoke active sessions/i));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Suspend$/ }));
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Suspend — tap again" })).toBeEnabled()
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /^Suspend/ }));

    // The PATCH succeeded but the revocation failed: an explicit error is
    // shown (never a plain success), and the row data is still refreshed so
    // the UI reflects the authoritative server state.
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });
});
