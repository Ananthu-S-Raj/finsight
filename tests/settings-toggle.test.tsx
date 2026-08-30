// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SETTINGS_KEY } from "@/lib/settingsCore";

vi.mock("@/lib/haptics", () => ({ haptic: vi.fn() }));

const pushMock = vi.hoisted(() => ({
  currentPermission: vi.fn(() => "granted"),
  getVapidIssue: vi.fn(() => "ok"),
  isSubscribed: vi.fn(),
  sendTestNotification: vi.fn(),
  subscribeForPush: vi.fn(),
  syncPushPrefs: vi.fn(async () => {}),
  unsubscribeFromPush: vi.fn(),
  supportsPush: vi.fn(() => true),
}));
vi.mock("@/lib/push", () => pushMock);

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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

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

function storedPushPref(): boolean {
  const raw = localStorage.getItem(SETTINGS_KEY);
  return raw ? (JSON.parse(raw).notifications?.push ?? false) : false;
}

const pushSwitch = () => screen.getByRole("switch", { name: "Push notifications" });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  pushMock.isSubscribed.mockResolvedValue(false);
  pushMock.sendTestNotification.mockResolvedValue({ ok: true, sent: 1 });
  pushMock.subscribeForPush.mockResolvedValue({ ok: true });
  pushMock.unsubscribeFromPush.mockResolvedValue({ removed: 1 });
  stubLocalStorage();
  stubMatchMedia();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Settings → Push notifications toggle", () => {
  it("defaults to OFF when no subscription is registered", async () => {
    renderSettings();
    await waitFor(() => expect(pushSwitch()).toHaveAttribute("aria-checked", "false"));
    expect(screen.queryByRole("button", { name: /send test notification/i })).toBeNull();
  });

  it("turns ON end-to-end: subscribes, persists the pref, and reports success", async () => {
    pushMock.isSubscribed
      .mockResolvedValueOnce(false) // mount check
      .mockResolvedValueOnce(true); // refresh after enable
    renderSettings();
    await waitFor(() => expect(pushSwitch()).toHaveAttribute("aria-checked", "false"));

    fireEvent.click(pushSwitch());

    await waitFor(() => {
      expect(pushMock.subscribeForPush).toHaveBeenCalledWith("u1");
    });
    expect(await screen.findByText("Notifications enabled.")).toBeInTheDocument();
    await waitFor(() => expect(storedPushPref()).toBe(true));
    // The toggle reflects the new state.
    expect(pushSwitch()).toHaveAttribute("aria-checked", "true");
    // Test button appears because the device is now genuinely registered.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /send test notification/i })).toBeInTheDocument();
    });
  });

  it("stays OFF and shows the real reason when the permission prompt is dismissed", async () => {
    pushMock.subscribeForPush.mockResolvedValue({ ok: false, reason: "default" });
    renderSettings();
    await waitFor(() => expect(pushSwitch()).toHaveAttribute("aria-checked", "false"));

    fireEvent.click(pushSwitch());

    expect(await screen.findByText(/notifications are pending/i)).toBeInTheDocument();
    expect(storedPushPref()).toBe(false);
    expect(pushSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("stays OFF and reports blocked permissions when the browser denies", async () => {
    pushMock.subscribeForPush.mockResolvedValue({ ok: false, reason: "denied" });
    renderSettings();
    await waitFor(() => expect(pushSwitch()).toHaveAttribute("aria-checked", "false"));

    fireEvent.click(pushSwitch());

    expect(await screen.findByText(/notifications are blocked/i)).toBeInTheDocument();
    expect(storedPushPref()).toBe(false);
  });

  it("stays OFF and reports missing VAPID configuration instead of a generic error", async () => {
    pushMock.subscribeForPush.mockResolvedValue({ ok: false, reason: "missing-vapid" });
    renderSettings();
    await waitFor(() => expect(pushSwitch()).toHaveAttribute("aria-checked", "false"));

    fireEvent.click(pushSwitch());

    expect(
      await screen.findByText(/push notifications are not configured on this deployment yet/i)
    ).toBeInTheDocument();
    expect(storedPushPref()).toBe(false);
  });

  it("stays OFF and reports an invalid VAPID key", async () => {
    pushMock.subscribeForPush.mockResolvedValue({ ok: false, reason: "invalid-vapid" });
    renderSettings();
    await waitFor(() => expect(pushSwitch()).toHaveAttribute("aria-checked", "false"));

    fireEvent.click(pushSwitch());

    expect(await screen.findByText(/push is misconfigured \(invalid VAPID key\)/i)).toBeInTheDocument();
    expect(storedPushPref()).toBe(false);
  });

  it("stays OFF and reports an unavailable service worker", async () => {
    pushMock.subscribeForPush.mockResolvedValue({ ok: false, reason: "no-worker" });
    renderSettings();
    await waitFor(() => expect(pushSwitch()).toHaveAttribute("aria-checked", "false"));

    fireEvent.click(pushSwitch());

    expect(
      await screen.findByText(/unable to register the notification service/i)
    ).toBeInTheDocument();
    expect(storedPushPref()).toBe(false);
  });

  it("stays OFF and reports a failed database save", async () => {
    pushMock.subscribeForPush.mockResolvedValue({ ok: false, reason: "save-failed" });
    renderSettings();
    await waitFor(() => expect(pushSwitch()).toHaveAttribute("aria-checked", "false"));

    fireEvent.click(pushSwitch());

    expect(
      await screen.findByText(/unable to save your notification subscription/i)
    ).toBeInTheDocument();
    expect(storedPushPref()).toBe(false);
  });

  it("never claims enabled when the browser subscribed but the server save failed", async () => {
    // Pre-seed an old "enabled" preference to prove the toggle is driven by the
    // real registration, not by stale state.
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ notifications: { push: true } }));
    pushMock.subscribeForPush.mockResolvedValue({ ok: false, reason: "save-failed" });
    renderSettings();

    // The stale pref says "enabled", but this device isn't registered, so the
    // toggle must reflect reality and stay OFF.
    await waitFor(() => expect(pushSwitch()).toHaveAttribute("aria-checked", "false"));

    fireEvent.click(pushSwitch());

    expect(await screen.findByText(/unable to save your notification subscription/i)).toBeInTheDocument();
    await waitFor(() => expect(pushMock.subscribeForPush).toHaveBeenCalledWith("u1"));
    // Still never enabled — pref cleared and toggle OFF.
    await waitFor(() => expect(storedPushPref()).toBe(false));
    expect(pushSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("turns OFF: unsubscribes the device, clears the pref, reports success", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ notifications: { push: true } }));
    pushMock.isSubscribed
      .mockResolvedValueOnce(true) // mount check finds the device registered
      .mockResolvedValueOnce(false); // refresh after disable
    renderSettings();
    await waitFor(() => expect(pushSwitch()).toHaveAttribute("aria-checked", "true"));

    fireEvent.click(pushSwitch());

    await waitFor(() => {
      expect(pushMock.unsubscribeFromPush).toHaveBeenCalledWith("u1");
    });
    expect(await screen.findByText("Notifications disabled.")).toBeInTheDocument();
    await waitFor(() => expect(storedPushPref()).toBe(false));
    expect(pushSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("sends a test notification only when this device is genuinely registered", async () => {
    pushMock.isSubscribed.mockResolvedValue(true);
    renderSettings();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /send test notification/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /send test notification/i }));

    await waitFor(() => expect(pushMock.sendTestNotification).toHaveBeenCalledWith("u1"));
    expect(await screen.findByText("Test notification sent.")).toBeInTheDocument();
  });
});