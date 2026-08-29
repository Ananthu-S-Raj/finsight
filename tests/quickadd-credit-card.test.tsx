// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToastProvider } from "@/components/ui/ToastProvider";
import QuickAddSheet from "@/components/QuickAddSheet";
import { USER_A_ID } from "./helpers/fixtures";

// Haptics / sound / events are cosmetic in tests.
vi.mock("@/lib/haptics", () => ({ haptic: vi.fn() }));
vi.mock("@/lib/sound", () => ({ playSound: vi.fn() }));
vi.mock("@/lib/events", () => ({ emitRefresh: vi.fn() }));
// No external categories (fall back to built-in presets) and no recent merchants.
vi.mock("@/lib/categoriesApi", () => ({ listCategories: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics")>();
  return {
    ...actual,
    getRecentMerchants: vi.fn().mockResolvedValue([]),
  };
});
// Capture rpc calls for recordSpend.
const rpcCalls: { name: string; args: unknown }[] = [];
vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: { overspend_amount: 0 }, error: null });
    },
    from: () => {
      throw new Error("unexpected table query in QuickAddSheet test");
    },
    auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
  },
}));

import { haptic } from "@/lib/haptics";

function stubMatchMedia() {
  // BottomSheet uses useReducedMotion -> matchMedia.
  const list = new Set<EventListener>();
  (window as unknown as { matchMedia: () => unknown }).matchMedia = () => ({
    matches: false,
    addEventListener: (_t: string, cb: EventListener) => list.add(cb),
    removeEventListener: (_t: string, cb: EventListener) => list.delete(cb),
  });
  // BottomSheet reads visualViewport for keyboard avoidance.
  (window as unknown as { visualViewport: unknown }).visualViewport = {
    height: 800,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

async function openEndToEnd(initialMode: "expense" | "credit" = "expense") {
  stubMatchMedia();
  render(
    <ToastProvider>
      <QuickAddSheet open onClose={() => {}} userId={USER_A_ID} initialMode={initialMode} />
    </ToastProvider>
  );
  // Let the sheet mount + category effects settle.
  await waitFor(() => expect(screen.queryAllByRole("switch").length).toBeGreaterThan(0));
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  rpcCalls.length = 0;
  // Restore window props between tests (cleanup may leave stubs).
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  delete (window as unknown as { visualViewport?: unknown }).visualViewport;
});

afterEach(() => {
  cleanup();
});

describe("QuickAdd credit-card toggle — single source of truth", () => {
  it("starts the expense flow with the card switch off", async () => {
    await openEndToEnd();
    const sw = screen.queryAllByRole("switch")[0];
    expect(sw).toBeDefined();
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });

  it("toggle flips state exactly once per click (no double-toggle)", async () => {
    await openEndToEnd();
    const sw = screen.queryAllByRole("switch")[0];
    expect(sw.getAttribute("aria-checked")).toBe("false");

    // A single click on the visual switch must yield a single net toggle.
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(haptic).toHaveBeenCalledTimes(1);
  });

  it("opening in credit mode starts the toggle on and labels the button 'Log card charge'", async () => {
    await openEndToEnd("credit");
    const sw = screen.queryAllByRole("switch")[0];
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: /log card charge/i })).toBeInTheDocument();
  });

  it("submits a card charge with p_is_credit_card=true through the RPC", async () => {
    await openEndToEnd();
    const sw = screen.queryAllByRole("switch")[0];
    fireEvent.click(sw);

    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "3500" },
    });

    fireEvent.click(screen.getByRole("button", { name: /log card charge/i }));

    await waitFor(() => {
      const call = rpcCalls.find((c) => c.name === "apply_expense");
      expect(call).toBeDefined();
      expect(call!.args).toMatchObject({ p_amount: 3500, p_is_credit_card: true });
    });
  });

  it("submits a normal expense with p_is_credit_card=false when the toggle stays off", async () => {
    await openEndToEnd("expense");

    // Toggle stays off (default state) -> "Add expense" is the submit label.
    expect(screen.getByRole("button", { name: /add expense/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "500" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add expense/i }));

    await waitFor(() => {
      const call = rpcCalls.find((c) => c.name === "apply_expense");
      expect(call).toBeDefined();
      expect(call!.args).toMatchObject({ p_amount: 500, p_is_credit_card: false });
    });
  });
});
