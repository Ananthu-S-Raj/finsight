// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const routerMocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock("@/lib/haptics", () => ({ haptic: vi.fn() }));

const pushMocks = vi.hoisted(() => ({
  currentPermission: vi.fn(() => "granted"),
  getVapidIssue: vi.fn(() => "ok"),
  isSubscribed: vi.fn(),
  sendTestNotification: vi.fn(),
  subscribeForPush: vi.fn(),
  syncPushPrefs: vi.fn(async () => {}),
  unsubscribeFromPush: vi.fn(),
  supportsPush: vi.fn(() => true),
}));
vi.mock("@/lib/push", () => pushMocks);

vi.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { signOut: vi.fn() } },
}));
vi.mock("@/lib/finance", () => ({ setDateOfBirth: vi.fn() }));
vi.mock("@/lib/useAuth", () => ({ useRequireAuth: () => "u1" }));
vi.mock("@/lib/usePageData", () => ({
  usePageData: () => ({
    profile: {
      full_name: "Test User",
      email: "test@example.com",
      role: "user",
      date_of_birth: null,
      salary_balance: 10000,
      savings_balance: 5000,
      monthly_budget: 30000,
    },
    txns: [],
    summary: { spent: 0, budget: 30000, remaining: 30000, isOverspent: false },
    loading: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => routerMocks }));

vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/PageHeader", () => ({ default: () => <div>header</div> }));
vi.mock("@/components/ui/GlassCard", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/Button", () => ({
  default: ({
    children,
    onClick,
    disabled,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/Icons", () => ({
  default: ({ name }: { name: string }) => <span data-icon={name}>.</span>,
}));
vi.mock("@/components/ui/SegmentedControl", () => ({ default: () => null }));
vi.mock("@/components/PasswordStrength", () => ({ default: () => null }));

import SettingsPage from "@/app/settings/page";
import { ToastProvider } from "@/components/ui/ToastProvider";

function stubMatchMedia() {
  const fake = {
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  (window as unknown as { matchMedia: () => typeof fake }).matchMedia = () => fake;
}

function stubLocalStorage() {
  vi.stubGlobal(
    "localStorage",
    new (class {
      private m = new Map<string, string>();
      getItem(k: string) {
        return this.m.get(k) ?? null;
      }
      setItem(k: string, v: string) {
        this.m.set(k, String(v));
      }
      removeItem(k: string) {
        this.m.delete(k);
      }
      clear() {
        this.m.clear();
      }
    })()
  );
}

function renderSettings() {
  render(
    <ToastProvider>
      <SettingsPage />
    </ToastProvider>
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  pushMocks.isSubscribed.mockResolvedValue(false);
  pushMocks.sendTestNotification.mockResolvedValue({ ok: true, sent: 1 });
  pushMocks.subscribeForPush.mockResolvedValue({ ok: true });
  pushMocks.unsubscribeFromPush.mockResolvedValue({ removed: 1 });
  stubLocalStorage();
  stubMatchMedia();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Settings → Report a Bug entry point", () => {
  it("places a Help & Support section with a Report a Bug row", async () => {
    renderSettings();
    expect(await screen.findByText("Help & Support")).toBeInTheDocument();
    expect(screen.getByText("Report a Bug")).toBeInTheDocument();
    expect(screen.getByText("Found something wrong? Tell us what happened.")).toBeInTheDocument();
  });

  it("navigates to the report form when the chevron is tapped", async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByLabelText("Report a bug")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Report a bug"));

    expect(routerMocks.push).toHaveBeenCalledWith("/settings/report-a-bug");
  });
});