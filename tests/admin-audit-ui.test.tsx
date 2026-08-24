// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { useAdminDataMock, useAdminAuthMock, toastMocks } = vi.hoisted(() => ({
  useAdminDataMock: vi.fn(),
  useAdminAuthMock: vi.fn(),
  toastMocks: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/admin/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/admin/client")>();
  return { ...original, useAdminAuth: useAdminAuthMock };
});
vi.mock("@/lib/admin/useAdminData", () => ({ useAdminData: useAdminDataMock }));
vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ success: toastMocks.success, error: toastMocks.error }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/admin/audit",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { signOut: vi.fn(async () => ({})) } },
}));

import AdminAuditPage from "@/app/admin/audit/page";

beforeEach(() => {
  cleanup();
  useAdminAuthMock.mockReturnValue({
    status: "authenticated",
    whoami: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "admin@finsight.app",
      role: "admin",
      permissions: ["AUDIT_LOG_VIEW", "USER_VIEW"],
    },
  });
  useAdminDataMock.mockReturnValue({
    status: "ready",
    data: { items: [], total: 0, page: 1, pages: 1 },
    error: null,
  });
});

describe("admin audit page filters", () => {
  it("renders the grouped action catalogue including lifecycle and auth actions", () => {
    render(<AdminAuditPage />);

    for (const group of [
      "Users",
      "Transactions",
      "Categories",
      "Notifications",
      "Roles & permissions",
      "Auth & security",
      "System",
      "Push",
    ]) {
      expect(screen.getByRole("group", { name: group })).toBeInTheDocument();
    }
    const actionSelect = screen.getByLabelText("Action filter");
    const options = Array.from(actionSelect.querySelectorAll("option")).map((o) => o.value);
    expect(options).toContain("user.sessions_revoke");
    expect(options).toContain("user.password_reset.request");
    expect(options).toContain("maintenance.toggle");
    expect(options).toContain("ADMIN_LOGIN");
  });

  it("exposes date range and actor/target ID filters", () => {
    render(<AdminAuditPage />);
    expect(screen.getByLabelText("From date")).toBeInTheDocument();
    expect(screen.getByLabelText("To date")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by actor user ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by target user ID")).toBeInTheDocument();
  });

  it("exposes the resource-type selector with the real audit vocabulary", () => {
    render(<AdminAuditPage />);
    const select = screen.getByLabelText("Resource type filter");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(options[0]).toBe(""); // "All resources"
    for (const type of [
      "app_settings",
      "category",
      "notification",
      "push_subscription",
      "role",
      "system",
      "transaction",
      "user",
    ]) {
      expect(options).toContain(type);
    }
  });

  it("passes resource filters to the query once set", () => {
    render(<AdminAuditPage />);
    fireEvent.change(screen.getByLabelText("Resource type filter"), { target: { value: "transaction" } });
    let calledWith = useAdminDataMock.mock.calls.at(-1)?.[0] as string;
    expect(calledWith).toContain("resourceType=transaction");
    expect(calledWith).not.toContain("resourceId=");

    fireEvent.change(screen.getByLabelText("Filter by resource ID"), {
      target: { value: "00000000-0000-4000-8000-000000000010" },
    });
    calledWith = useAdminDataMock.mock.calls.at(-1)?.[0] as string;
    expect(calledWith).toContain("resourceType=transaction");
    expect(calledWith).toContain("resourceId=00000000-0000-4000-8000-000000000010");
  });

  it("includes resource filters in reset behaviour and dirty tracking", () => {
    render(<AdminAuditPage />);
    const reset = screen.getByRole("button", { name: "Reset filters" });
    fireEvent.change(screen.getByLabelText("Resource type filter"), { target: { value: "user" } });
    fireEvent.change(screen.getByLabelText("Filter by resource ID"), {
      target: { value: "00000000-0000-4000-8000-000000000003" },
    });
    expect(reset).toBeEnabled();

    fireEvent.click(reset);
    expect((screen.getByLabelText("Resource type filter") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Filter by resource ID") as HTMLInputElement).value).toBe("");
    expect(reset).toBeDisabled();

    const calledWith = useAdminDataMock.mock.calls.at(-1)?.[0] as string;
    expect(calledWith).not.toContain("resourceType=");
    expect(calledWith).not.toContain("resourceId=");
  });

  it("keeps Reset disabled while pristine and enables it once a filter is set", () => {
    render(<AdminAuditPage />);
    const reset = screen.getByRole("button", { name: "Reset filters" });
    expect(reset).toBeDisabled();

    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-08-01" } });
    expect(reset).toBeEnabled();

    fireEvent.click(reset);
    expect((screen.getByLabelText("From date") as HTMLInputElement).value).toBe("");
    expect(reset).toBeDisabled();
  });

  it("passes the new filter axes to the audit-logs query", () => {
    render(<AdminAuditPage />);
    fireEvent.change(screen.getByLabelText("Filter by actor user ID"), {
      target: { value: "00000000-0000-4000-8000-000000000009" },
    });
    const calledWith = useAdminDataMock.mock.calls.at(-1)?.[0] as string;
    expect(calledWith).toContain("/audit-logs?");
    expect(calledWith).toContain("actorId=00000000-0000-4000-8000-000000000009");
    expect(calledWith).toContain("page=1");
  });
});
