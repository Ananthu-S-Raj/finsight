// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
  usePathname: () => "/admin/users",
}));
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { signOut: vi.fn(async () => ({})) } },
}));

import AdminUsersPage from "@/app/admin/users/page";

/**
 * G-07 console controls: sortable columns and an unverified-only toggle.
 * The request path handed to useAdminData is the contract under test — it
 * must carry sort/order/verified only when explicitly chosen so the API's
 * default ordering stays untouched for existing clients.
 */

const PERMS = ["USER_VIEW", "ROLE_MANAGE", "USER_SUSPEND"];

function user(id: string, extra = {}) {
  return {
    id,
    email: `${id}@x.io`,
    full_name: `User ${id}`,
    role: "user",
    account_status: "active",
    monthly_budget: 0,
    created_at: "2026-01-01T00:00:00Z",
    last_login_at: null,
    last_active_at: null,
    email_confirmed_at: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

function queryParams(): URLSearchParams {
  const path = useAdminDataMock.mock.lastCall?.[0] as string;
  return new URLSearchParams(path.split("?")[1] ?? "");
}

beforeEach(() => {
  cleanup();
  useAdminDataMock.mockReset();
  adminFetchMock.mockReset();
  toastMocks.success.mockReset();
  toastMocks.error.mockReset();
  useAdminDataMock.mockImplementation(() => ({
    status: "ready",
    data: {
      items: [user("u1"), user("u2", { full_name: "User u2", email_confirmed_at: null })],
      total: 2,
      page: 1,
      pageSize: 15,
      pages: 1,
    },
    error: null,
    refresh: vi.fn(),
  }));
  useAdminAuthMock.mockReturnValue({
    status: "ready",
    whoami: {
      id: "u1",
      email: "admin@finsight.app",
      role: "admin",
      permissions: PERMS,
    },
  });
});

describe("users list sorting (G-07)", () => {
  it("sends no sort/order/verified params by default so server defaults hold", () => {
    render(<AdminUsersPage />);
    const q = queryParams();
    expect(q.get("sort")).toBeNull();
    expect(q.get("order")).toBeNull();
    expect(q.get("verified")).toBeNull();
    expect(q.get("page")).toBe("1");
    expect(q.get("pageSize")).toBe("15");
  });

  it("sorts by name ascending on first header click", () => {
    render(<AdminUsersPage />);
    fireEvent.click(screen.getByRole("button", { name: /sort by name/i }));
    const q = queryParams();
    expect(q.get("sort")).toBe("full_name");
    expect(q.get("order")).toBe("asc");
    expect(q.get("page")).toBe("1");
  });

  it("toggles to descending on a second click of the same column", () => {
    render(<AdminUsersPage />);
    const header = screen.getByRole("button", { name: /sort by name/i });
    fireEvent.click(header);
    fireEvent.click(header);
    expect(queryParams().get("order")).toBe("desc");
  });

  it("switches columns back to ascending when another column is clicked", () => {
    render(<AdminUsersPage />);
    const name = screen.getByRole("button", { name: /sort by name/i });
    fireEvent.click(name);
    fireEvent.click(name); // desc
    fireEvent.click(screen.getByRole("button", { name: /sort by status/i }));
    const q = queryParams();
    expect(q.get("sort")).toBe("account_status");
    expect(q.get("order")).toBe("asc");
  });

  it("exposes creation-date sorting via its own column header", () => {
    render(<AdminUsersPage />);
    fireEvent.click(screen.getByRole("button", { name: /sort by created/i }));
    const q = queryParams();
    expect(q.get("sort")).toBe("created_at");
    expect(q.get("order")).toBe("asc");
  });

  it("marks the active column with a direction indicator", () => {
    render(<AdminUsersPage />);
    const name = screen.getByRole("button", { name: /sort by name/i });
    expect(name.textContent).not.toMatch(/[↑↓]/);
    fireEvent.click(name);
    expect(name.textContent).toMatch(/↑/);
    fireEvent.click(name);
    expect(name.textContent).toMatch(/↓/);
  });
});

describe("unverified-only filter (G-07)", () => {
  it("adds verified=false while checked and drops it once unchecked", () => {
    render(<AdminUsersPage />);
    const box = screen.getByRole("checkbox", { name: /unverified only/i });
    fireEvent.click(box);
    expect(queryParams().get("verified")).toBe("false");
    fireEvent.click(box);
    expect(queryParams().get("verified")).toBeNull();
  });

  it("combines with the role/status filters and resets to page 1", () => {
    render(<AdminUsersPage />);
    fireEvent.change(screen.getByLabelText(/filter by role/i), { target: { value: "user" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /unverified only/i }));
    const q = queryParams();
    expect(q.get("verified")).toBe("false");
    expect(q.get("role")).toBe("user");
    expect(q.get("page")).toBe("1");
  });

  it("keeps sort and verified filters when paging forward", () => {
    useAdminDataMock.mockImplementation(() => ({
      status: "ready",
      data: {
        items: [user("u2", { email_confirmed_at: null })],
        total: 17,
        page: 1,
        pageSize: 15,
        pages: 2,
      },
      error: null,
      refresh: vi.fn(),
    }));
    render(<AdminUsersPage />);
    fireEvent.click(screen.getByRole("checkbox", { name: /unverified only/i }));
    fireEvent.click(screen.getByRole("button", { name: /sort by created/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    const q = queryParams();
    expect(q.get("page")).toBe("2");
    expect(q.get("verified")).toBe("false");
    expect(q.get("sort")).toBe("created_at");
    expect(q.get("order")).toBe("asc");
  });
});
