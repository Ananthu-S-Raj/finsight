// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import AdminShell from "@/components/admin/AdminShell";
import type { Whoami } from "@/lib/admin/client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/admin/dashboard",
}));
vi.mock("@/lib/haptics", () => ({ haptic: vi.fn() }));
vi.mock("@/lib/hooks", () => ({
  // Desktop layout only; the mobile drawer renders the same nav list.
  useMediaQuery: (query: string) => query.includes("min-width"),
}));
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { signOut: vi.fn(async () => ({})) } },
}));

function whoami(permissions: string[]): Whoami {
  return { id: "00000000-0000-4000-8000-000000000001", email: "admin@finsight.app", role: "admin", permissions };
}

beforeEach(() => {
  cleanup();
});

describe("AdminShell navigation permission filtering (F-04 UI consistency)", () => {
  it("shows the Dashboard nav item for admins with REPORT_VIEW", () => {
    render(
      <AdminShell whoami={whoami(["REPORT_VIEW", "USER_VIEW"])}>
        <div />
      </AdminShell>
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
  });

  it("hides the Dashboard nav item for admins without REPORT_VIEW", () => {
    render(
      <AdminShell whoami={whoami(["USER_VIEW"])}>
        <div />
      </AdminShell>
    );
    expect(screen.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
    // Unrelated navigation is unaffected by its own permission.
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
  });
});
