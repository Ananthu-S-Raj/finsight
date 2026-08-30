// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToastProvider } from "@/components/ui/ToastProvider";
import NotificationPermissionCard from "@/components/NotificationPermissionCard";
import { SETTINGS_KEY } from "@/lib/settingsCore";

vi.mock("@/lib/haptics", () => ({ haptic: vi.fn() }));

const { rows, insertMock, fromMock } = vi.hoisted(() => {
  const rows: { id: string; subscription: { endpoint?: string } }[] = [];
  const insertMock = vi.fn(async () => ({ error: null }));
  const fromMock = vi.fn((table: string) =>
    table === "push_subscriptions"
      ? {
          insert: (v: unknown) => {
            insertMock(v);
            return Promise.resolve({ error: null });
          },
          select: () => ({ eq: vi.fn(async () => ({ data: rows, error: null })) }),
          update: () => ({ eq: vi.fn(async () => ({ error: null })) }),
          delete: () => ({ eq: vi.fn(async () => ({ error: null })) }),
        }
      : { select: vi.fn() }
  );
  return { rows, insertMock, fromMock };
});

vi.mock("@/lib/supabaseClient", () => ({ supabase: { from: fromMock } }));

function stubMatchMedia() {
  const fake = {
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  (window as unknown as { matchMedia: () => typeof fake }).matchMedia = () => fake;
}

function stubPushGranted(deliver: { endpoint: string | null; subscribeThrows?: boolean }) {
  const sub = deliver.endpoint ? { endpoint: deliver.endpoint, toJSON: () => ({ endpoint: deliver.endpoint }) } : null;
  const pushManager = {
    getSubscription: vi.fn(async () => sub),
    subscribe: vi.fn(async () => {
      if (deliver.subscribeThrows) throw new Error("push service rejected");
      return sub;
    }),
  };
  vi.stubGlobal("navigator", { ...navigator, serviceWorker: { ready: Promise.resolve({ pushManager }) } });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal(
    "Notification",
    class {
      static permission = "granted";
      static requestPermission = vi.fn(async () => "granted");
    }
  );
}

function stubPushDenied() {
  vi.stubGlobal("navigator", { ...navigator, serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: vi.fn(async () => null), subscribe: vi.fn() } }) } });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal(
    "Notification",
    class {
      static permission = "denied";
      static requestPermission = vi.fn(async () => "denied");
    }
  );
}

function renderCard() {
  render(
    <ToastProvider>
      <NotificationPermissionCard userId="u1" />
    </ToastProvider>
  );
  return screen.getByRole("button", { name: /enable notifications/i });
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  rows.length = 0;
  localStorage.clear();
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
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
      clear() {
        this.m.clear();
      }
    })()
  );
  stubMatchMedia();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
});

function storedPushPref(): boolean {
  const value = localStorage.getItem(SETTINGS_KEY);
  return value ? (JSON.parse(value).notifications?.push ?? false) : false;
}

describe("NotificationPermissionCard — failure classification", () => {
  it("reports invalid VAPID configuration instead of a generic error", async () => {
    stubPushGranted({ endpoint: null });
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "generated-vapid-public-key";

    const btn = renderCard();
    await fireEvent.click(btn);

    expect(await screen.findByText(/Push is misconfigured \(invalid VAPID key\)/i)).toBeInTheDocument();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("keeps the pref off when VAPID is missing and explains setup is needed", async () => {
    // Pre-seed push=true to prove the handler never leaves it on.
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ notifications: { push: true } }));
    stubPushGranted({ endpoint: null });

    const btn = renderCard();
    await fireEvent.click(btn);

    expect(await screen.findByText(/Push notifications are not configured on this deployment yet/i)).toBeInTheDocument();
    await waitFor(() => expect(storedPushPref()).toBe(false));
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("reports a blocked browser permission state", async () => {
    // When the browser permission is already denied the card renders the
    // blocked-state notice directly (no clickable enable button).
    stubPushDenied();
    render(
      <ToastProvider>
        <NotificationPermissionCard userId="u1" />
      </ToastProvider>
    );

    expect(
      await screen.findByText(/Notifications are blocked/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /enable notifications/i })
    ).toBeNull();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("reports browsers without push support", async () => {
    // No PushManager/Notification stubs → unsupported.
    const btn = renderCard();
    await fireEvent.click(btn);

    expect(await screen.findByText(/This browser doesn't support notifications\./i)).toBeInTheDocument();
  });

  it("reports a generic failure when the push service rejects the request", async () => {
    stubPushGranted({ endpoint: null, subscribeThrows: true });
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "A".repeat(87);
    const btn = renderCard();
    await fireEvent.click(btn);

    expect(await screen.findByText(/Couldn't enable notifications right now\./i)).toBeInTheDocument();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("enables push end-to-end and hides the card once subscribed", async () => {
    stubPushGranted({ endpoint: "https://push.example/a" });
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "A".repeat(87);

    const btn = renderCard();
    await fireEvent.click(btn);

    expect(await screen.findByText(/Notifications enabled\./i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: /enable notifications/i })).toBeNull());
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});