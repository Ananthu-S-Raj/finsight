// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToastProvider } from "@/components/ui/ToastProvider";
import QuickAddSheet from "@/components/QuickAddSheet";
import { USER_A_ID } from "./helpers/fixtures";

vi.mock("@/lib/haptics", () => ({ haptic: vi.fn() }));
vi.mock("@/lib/sound", () => ({ playSound: vi.fn() }));
vi.mock("@/lib/events", () => ({ emitRefresh: vi.fn() }));
vi.mock("@/lib/categoriesApi", () => ({ listCategories: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics")>();
  return {
    ...actual,
    getRecentMerchants: vi.fn().mockResolvedValue([]),
  };
});

// Capture rpc calls so we can assert the savings route is used (and no salary
// / expense route is taken).
const rpcCalls: { name: string; args: unknown }[] = [];
vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: { overspend_amount: 0 }, error: null });
    },
    from: () => {
      throw new Error("unexpected table query in QuickAddSheet savings test");
    },
    auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
  },
}));

function stubMatchMedia() {
  const list = new Set<EventListener>();
  (window as unknown as { matchMedia: () => unknown }).matchMedia = () => ({
    matches: false,
    addEventListener: (_t: string, cb: EventListener) => list.add(cb),
    removeEventListener: (_t: string, cb: EventListener) => list.delete(cb),
  });
  (window as unknown as { visualViewport: unknown }).visualViewport = {
    height: 800,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

async function openSavings() {
  stubMatchMedia();
  render(
    <ToastProvider>
      <QuickAddSheet open onClose={() => {}} userId={USER_A_ID} initialMode="savings" />
    </ToastProvider>
  );
  // Let the sheet mount + category effects settle (income flow has no switch,
  // so wait for the income "Type" selector instead).
  await waitFor(() => expect(screen.getByRole("button", { name: "Savings" })).toBeInTheDocument());
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  rpcCalls.length = 0;
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  delete (window as unknown as { visualViewport?: unknown }).visualViewport;
});

afterEach(() => {
  cleanup();
});

describe("QuickAdd — initial custom savings (Bug 3)", () => {
  it("opens in the income flow with the Savings type pre-selected (not the expense flow)", async () => {
    await openSavings();

    // The income flow is active: there is no credit-card expense switch and the
    // submit button is the income button, not "Add expense".
    expect(screen.queryByRole("button", { name: /add expense/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add income/i })).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("submits an initial savings amount via apply_income(p_kind='savings'), never touching salary", async () => {
    await openSavings();

    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add income/i }));

    await waitFor(() => {
      const call = rpcCalls.find((c) => c.name === "apply_income");
      expect(call).toBeDefined();
      expect(call!.args).toMatchObject({ p_kind: "savings", p_amount: 1000 });
    });

    // A savings add must never route through the expense / salary path.
    expect(rpcCalls.some((c) => c.name === "apply_expense")).toBe(false);
  });

  it("rejects a zero / empty initial savings amount", async () => {
    await openSavings();

    fireEvent.click(screen.getByRole("button", { name: /add income/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/enter an amount greater than zero/i)
      ).toBeInTheDocument();
    });
    expect(rpcCalls.length).toBe(0);
  });
});
