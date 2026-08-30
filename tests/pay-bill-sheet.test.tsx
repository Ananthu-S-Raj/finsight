// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToastProvider } from "@/components/ui/ToastProvider";
import PayBillSheet from "@/components/PayBillSheet";
import { emitRefresh } from "@/lib/events";

// Haptics / events are cosmetic in tests.
vi.mock("@/lib/haptics", () => ({ haptic: vi.fn() }));
vi.mock("@/lib/events", () => ({ emitRefresh: vi.fn() }));

// Capture pay_credit_card calls and let each test control the RPC response.
const rpcCalls: { name: string; args: unknown }[] = [];
let rpcResult: { data: unknown; error: unknown } = {
  data: { outstanding: 3000, source: "salary" },
  error: null,
};
vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResult);
    },
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

function renderSheet(
  overrides: Partial<{
    outstanding: number;
    accountBalance: number;
    savingsBalance: number;
    onClose: () => void;
  }> = {}
) {
  stubMatchMedia();
  render(
    <ToastProvider>
      <PayBillSheet
        open
        onClose={overrides.onClose ?? (() => {})}
        outstanding={overrides.outstanding ?? 5000}
        accountBalance={overrides.accountBalance ?? 3000}
        savingsBalance={overrides.savingsBalance ?? 2000}
      />
    </ToastProvider>
  );
}

/** Submit button name includes the rupee symbol, e.g. "Pay ₹2,000". */
const payButton = (amount: number) => screen.getByRole("button", { name: new RegExp(`Pay ₹${amount.toLocaleString("en-IN")}`) });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  rpcCalls.length = 0;
  rpcResult = { data: { outstanding: 3000, source: "salary" }, error: null };
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  delete (window as unknown as { visualViewport?: unknown }).visualViewport;
});

afterEach(() => {
  cleanup();
});

describe("PayBillSheet", () => {
  it("shows the outstanding amount in the header", () => {
    renderSheet({ outstanding: 5000 });
    expect(screen.getByText(/5,000 outstanding/i)).toBeInTheDocument();
  });

  it("does not render when there is nothing outstanding", () => {
    renderSheet({ outstanding: 0 });
    expect(screen.queryByText(/pay from/i)).not.toBeInTheDocument();
  });

  it("renders both payable sources with their balances", () => {
    renderSheet({ accountBalance: 3000, savingsBalance: 2000 });
    expect(screen.getByRole("button", { name: /account balance/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /savings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /account balance/i }).textContent).toMatch(/3,000/);
    expect(screen.getByRole("button", { name: /savings/i }).textContent).toMatch(/2,000/);
  });

  it("offers a Pay full quick amount capped at the chosen source balance", () => {
    renderSheet({ outstanding: 5000, accountBalance: 3000, savingsBalance: 2000 });
    // Quick chip caps at the selected (salary) balance = ₹3,000.
    expect(screen.getByRole("button", { name: /Pay full ₹3,000/ })).toBeInTheDocument();
  });

  it("submits a salary payment through pay_credit_card", async () => {
    renderSheet({ outstanding: 5000, accountBalance: 10000, savingsBalance: 2000 });
    fireEvent.change(screen.getByLabelText("Payment amount"), {
      target: { value: "2000" },
    });
    fireEvent.click(payButton(2000));

    await waitFor(() => {
      const call = rpcCalls.find((c) => c.name === "pay_credit_card");
      expect(call).toBeDefined();
      expect(call!.args).toMatchObject({ p_amount: 2000, p_source: "salary" });
    });
  });

  it("submits a savings-source payment when savings is selected", async () => {
    renderSheet({ outstanding: 5000, accountBalance: 0, savingsBalance: 5000 });
    fireEvent.click(screen.getByRole("button", { name: /savings/i }));
    fireEvent.change(screen.getByLabelText("Payment amount"), {
      target: { value: "1500" },
    });
    fireEvent.click(payButton(1500));

    await waitFor(() => {
      const call = rpcCalls.find((c) => c.name === "pay_credit_card");
      expect(call).toBeDefined();
      expect(call!.args).toMatchObject({ p_amount: 1500, p_source: "savings" });
    });
  });

  it("rejects an amount above the outstanding bill without calling the RPC", async () => {
    renderSheet({ outstanding: 1000, accountBalance: 10000, savingsBalance: 2000 });
    fireEvent.change(screen.getByLabelText("Payment amount"), {
      target: { value: "2000" },
    });
    fireEvent.click(payButton(2000));

    await waitFor(() => {
      expect(rpcCalls.filter((c) => c.name === "pay_credit_card")).toHaveLength(0);
    });
    expect(screen.getByText(/more than your outstanding/i)).toBeInTheDocument();
  });

  it("rejects an amount above the chosen source balance without calling the RPC", async () => {
    renderSheet({ outstanding: 9000, accountBalance: 1000, savingsBalance: 2000 });
    fireEvent.change(screen.getByLabelText("Payment amount"), {
      target: { value: "5000" },
    });
    fireEvent.click(payButton(5000));

    await waitFor(() => {
      expect(rpcCalls.filter((c) => c.name === "pay_credit_card")).toHaveLength(0);
    });
    expect(screen.getByText(/not enough in your account balance/i)).toBeInTheDocument();
  });

  it("Pay full chip fills the amount field and submits that exact amount", async () => {
    renderSheet({ outstanding: 5000, accountBalance: 3000, savingsBalance: 2000 });
    fireEvent.click(screen.getByRole("button", { name: /Pay full ₹3,000/ }));

    const input = screen.getByLabelText("Payment amount") as HTMLInputElement;
    expect(input.value).toBe("3000");
    fireEvent.click(payButton(3000));

    await waitFor(() => {
      const call = rpcCalls.find((c) => c.name === "pay_credit_card");
      expect(call).toBeDefined();
      expect(call!.args).toMatchObject({ p_amount: 3000, p_source: "salary" });
    });
  });

  it("a successful payment emits a refresh, shows success, and closes the sheet", async () => {
    let closed = false;
    renderSheet({ outstanding: 5000, accountBalance: 10000, savingsBalance: 2000, onClose: () => (closed = true) });
    fireEvent.change(screen.getByLabelText("Payment amount"), {
      target: { value: "2000" },
    });
    fireEvent.click(payButton(2000));

    await waitFor(() => {
      expect(rpcCalls.some((c) => c.name === "pay_credit_card")).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText(/paid ₹2,000 toward your card bill/i)).toBeInTheDocument();
      expect(closed).toBe(true);
    });
    expect(emitRefresh).toHaveBeenCalledTimes(1);
  });

  it("surfaces an RPC rejection as an inline error and keeps the sheet open", async () => {
    let closed = false;
    rpcResult = { data: null, error: { message: "insufficient_balance" } };
    renderSheet({ outstanding: 5000, accountBalance: 3000, savingsBalance: 2000, onClose: () => (closed = true) });
    fireEvent.change(screen.getByLabelText("Payment amount"), {
      target: { value: "2000" },
    });
    fireEvent.click(payButton(2000));

    await waitFor(() => {
      expect(rpcCalls.some((c) => c.name === "pay_credit_card")).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText(/not enough in your salary balance to cover that amount/i)).toBeInTheDocument();
      expect(closed).toBe(false);
    });
    expect(emitRefresh).not.toHaveBeenCalled();
  });
});