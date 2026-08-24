// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import AdminRolesPage from "@/app/admin/roles/page";
import type { RoleWithPermissions } from "@/lib/admin/client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/roles",
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

const { useAdminAuthMock, useAdminDataMock } = vi.hoisted(() => ({
  useAdminAuthMock: vi.fn(),
  useAdminDataMock: vi.fn(),
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
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const EDITORS_ID = "00000000-0000-4000-8000-000000000011";

function rolesFixture(): RoleWithPermissions[] {
  return [
    {
      id: "00000000-0000-4000-8000-000000000012",
      name: "admin",
      description: "Seeded",
      is_system: true,
      permissions: ["USER_VIEW", "USER_EDIT"],
    },
    {
      id: EDITORS_ID,
      name: "editors",
      description: "Custom role",
      is_system: false,
      permissions: ["USER_VIEW"],
    },
  ];
}

function mockState(permissions: string[]) {
  useAdminAuthMock.mockReturnValue({
    status: "ready",
    whoami: { id: "a1", email: "admin@finsight.app", role: "admin", permissions },
  });
  useAdminDataMock.mockReturnValue({ status: "ready", data: rolesFixture(), refresh });
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("role matrix ROLE_MANAGE gating", () => {
  it("offers toggle controls on custom roles for admins with ROLE_MANAGE", () => {
    mockState(["ROLE_MANAGE", "USER_VIEW"]);
    render(<AdminRolesPage />);

    // Custom role cells are interactive.
    expect(screen.getByRole("button", { name: "Revoke USER_VIEW from editors" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grant USER_EDIT to editors" })).toBeInTheDocument();
    expect(screen.getByText("Role matrix — click a cell on a custom role to grant or revoke")).toBeInTheDocument();
  });

  it("never offers controls on system roles, even with ROLE_MANAGE", () => {
    mockState(["ROLE_MANAGE"]);
    render(<AdminRolesPage />);

    expect(screen.queryByRole("button", { name: /admin$/ })).not.toBeInTheDocument();
    expect(screen.getByText(/System roles are protected and cannot be modified/)).toBeInTheDocument();
  });

  it("renders a fully read-only matrix without ROLE_MANAGE", () => {
    mockState(["USER_VIEW"]);
    render(<AdminRolesPage />);

    expect(screen.queryByRole("button", { name: /Grant |Revoke / })).not.toBeInTheDocument();
    expect(screen.getByText("Read-only role matrix")).toBeInTheDocument();
  });

  it("sends a revoke request when a granted cell is toggled", async () => {
    mockState(["ROLE_MANAGE"]);
    adminFetch.mockResolvedValue({ revoked: true });
    render(<AdminRolesPage />);

    fireEvent.click(screen.getByRole("button", { name: "Revoke USER_VIEW from editors" }));
    await waitFor(() =>
      expect(adminFetch).toHaveBeenCalledWith(`/roles/${EDITORS_ID}/permissions/USER_VIEW`, { method: "DELETE" })
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("sends a grant request when an ungranted cell is toggled", async () => {
    mockState(["ROLE_MANAGE"]);
    adminFetch.mockResolvedValue({ granted: true });
    render(<AdminRolesPage />);

    fireEvent.click(screen.getByRole("button", { name: "Grant USER_EDIT to editors" }));
    await waitFor(() =>
      expect(adminFetch).toHaveBeenCalledWith(`/roles/${EDITORS_ID}/permissions`, {
        method: "POST",
        body: JSON.stringify({ permission_id: "USER_EDIT" }),
      })
    );
  });

  it("leaves the matrix untouched when the server rejects a toggle", async () => {
    mockState(["ROLE_MANAGE"]);
    adminFetch.mockRejectedValue(new Error("That permission is already granted to this role."));
    render(<AdminRolesPage />);

    const cell = screen.getByRole("button", { name: "Revoke USER_VIEW from editors" });
    fireEvent.click(cell);
    // The row is refreshed only after a successful mutation; on failure the
    // matrix keeps showing authoritative server state.
    await waitFor(() => expect(adminFetch).toHaveBeenCalled());
    expect(refresh).not.toHaveBeenCalled();
    // Busy state clears so further edits remain possible.
    await waitFor(() => expect(cell).toBeEnabled());
  });
});
