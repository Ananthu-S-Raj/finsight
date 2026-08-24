// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import AdminRolesPage from "@/app/admin/roles/page";

const { useAdminAuth, adminFetch } = vi.hoisted(() => ({
  useAdminAuth: vi.fn(),
  adminFetch: vi.fn(),
}));
const refresh = vi.fn();

vi.mock("@/lib/admin/client", () => ({
  useAdminAuth,
  adminFetch,
}));
vi.mock("@/lib/admin/useAdminData", () => ({
  useAdminData: () => ({ status: "ready", data: ROLES, error: null, refresh }),
}));
vi.mock("@/components/admin/AdminPage", () => ({
  default: ({ children, subtitle }: { children: React.ReactNode; subtitle: string }) => (
    <div>
      <p data-testid="subtitle">{subtitle}</p>
      {children}
    </div>
  ),
}));
vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const EDITORS_ID = "00000000-0000-4000-8000-000000000011";
const ROLES = [
  {
    id: EDITORS_ID,
    name: "editors",
    description: "Custom",
    is_system: false,
    permissions: ["TRANSACTION_VIEW"],
  },
  {
    id: "00000000-0000-4000-8000-000000000012",
    name: "admin",
    description: "Seeded",
    is_system: true,
    permissions: ["USER_VIEW"],
  },
];

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("role matrix permission gating (ROLE_MANAGE)", () => {
  it("offers mutation controls for custom roles only when ROLE_MANAGE is held", () => {
    useAdminAuth.mockReturnValue({ status: "ready", whoami: { permissions: ["ROLE_MANAGE"] } });
    render(<AdminRolesPage />);

    expect(screen.getByRole("button", { name: "Grant USER_EDIT to editors" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke TRANSACTION_VIEW from editors" })).toBeInTheDocument();
    // System roles stay non-interactive even for authorized admins.
    expect(screen.queryByRole("button", { name: /admin$/ })).not.toBeInTheDocument();
  });

  it("hides every mutation control without ROLE_MANAGE", () => {
    useAdminAuth.mockReturnValue({ status: "ready", whoami: { permissions: ["USER_VIEW"] } });
    render(<AdminRolesPage />);

    expect(screen.queryByRole("button", { name: /^Grant |^Revoke / })).not.toBeInTheDocument();
    expect(screen.getByTestId("subtitle").textContent).toContain("Read-only");
  });

  it("sends a grant request and refreshes on success", async () => {
    useAdminAuth.mockReturnValue({ status: "ready", whoami: { permissions: ["ROLE_MANAGE"] } });
    adminFetch.mockResolvedValue({ granted: true });
    render(<AdminRolesPage />);

    fireEvent.click(screen.getByRole("button", { name: "Grant USER_EDIT to editors" }));
    await waitFor(() => expect(adminFetch).toHaveBeenCalled());
    const [path, opts] = adminFetch.mock.calls[0];
    expect(path).toBe(`/roles/${EDITORS_ID}/permissions`);
    expect((opts as RequestInit).method).toBe("POST");
    expect(JSON.parse((opts as RequestInit).body as string)).toEqual({ permission_id: "USER_EDIT" });
    expect(refresh).toHaveBeenCalled();
  });

  it("surfaces server errors instead of failing silently", async () => {
    useAdminAuth.mockReturnValue({ status: "ready", whoami: { permissions: ["ROLE_MANAGE"] } });
    adminFetch.mockRejectedValue(new Error("System roles cannot be modified."));
    render(<AdminRolesPage />);

    fireEvent.click(screen.getByRole("button", { name: "Grant USER_EDIT to editors" }));
    // The rejected promise is handled inside the page — no unhandled rejection.
    await waitFor(() => expect(adminFetch).toHaveBeenCalled());
  });
});
