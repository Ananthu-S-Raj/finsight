// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Transaction } from "@/lib/finance";

// Page + sheet deps are mocked to keep the test focused on the cards page
// wiring. The sheets (PayBillSheet, CardFormSheet) and BottomSheet are REAL so
// the flows truly call the mocked RPC helpers.
const mocks = vi.hoisted(() => ({
  useCreditCards: vi.fn(),
  deleteCreditCard: vi.fn(),
  createCreditCard: vi.fn(),
  updateCreditCard: vi.fn(),
  payCardBill: vi.fn(),
  payCreditCard: vi.fn(),
  useRequireAuth: vi.fn(() => "u1"),
  usePageData: vi.fn(),
  haptic: vi.fn(),
  emitRefresh: vi.fn(),
}));

vi.mock("@/lib/useAuth", () => ({ useRequireAuth: mocks.useRequireAuth }));
vi.mock("@/lib/usePageData", () => ({ usePageData: mocks.usePageData }));
vi.mock("@/lib/haptics", () => ({ haptic: mocks.haptic }));
vi.mock("@/lib/events", () => ({ emitRefresh: mocks.emitRefresh }));
vi.mock("@/lib/cards", () => ({
  useCreditCards: mocks.useCreditCards,
  deleteCreditCard: mocks.deleteCreditCard,
  createCreditCard: mocks.createCreditCard,
  updateCreditCard: mocks.updateCreditCard,
  payCardBill: mocks.payCardBill,
}));
vi.mock("@/lib/finance", () => ({ payCreditCard: mocks.payCreditCard }));
vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/PageHeader", () => ({
  default: ({ title, subtitle, actions }: { title?: string; subtitle?: string; actions?: React.ReactNode }) => (
    <div data-testid="page-header">
      {title}
      {subtitle}
      {actions}
    </div>
  ),
}));
vi.mock("@/components/ui/GlassCard", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/TransactionDetailSheet", () => ({ default: () => null }));

import CardsPage from "@/app/cards/page";
import { ToastProvider } from "@/components/ui/ToastProvider";

const PROFILE = {
  full_name: "Test User",
  email: "test@example.com",
  role: "user",
  date_of_birth: null,
  salary_balance: 80000,
  savings_balance: 15000,
  monthly_budget: 30000,
};

const CARD_HDFC = {
  id: "hdfc-1",
  user_id: "u1",
  name: "HDFC Millennia",
  credit_limit: 50000,
  billing_day: 15,
  outstanding: 12500,
  available: 37500,
  created_at: "2026-05-01T00:00:00Z",
};
const CARD_SBI = {
  id: "sbi-1",
  user_id: "u1",
  name: "SBI Cashback",
  credit_limit: 30000,
  billing_day: 5,
  outstanding: 8000,
  available: 22000,
  created_at: "2026-04-01T00:00:00Z",
};
const CARD_ZERO = {
  id: "zero-1",
  user_id: "u1",
  name: "Amex Travel",
  credit_limit: 100000,
  billing_day: 20,
  outstanding: 0,
  available: 100000,
  created_at: "2026-03-01T00:00:00Z",
};

const TXN_HDFC: Transaction = {
  id: "txn-1",
  user_id: "u1",
  type: "credit_card",
  category: "Shopping",
  subcategory: "Electronics",
  amount: 2500,
  overspend_amount: 0,
  note: "headphones",
  created_at: "2026-05-20T10:00:00Z",
  card_id: "hdfc-1",
};

const TXN_ORPHAN: Transaction = {
  id: "txn-orphan",
  user_id: "u1",
  type: "credit_card",
  category: "Food",
  subcategory: "Dining",
  amount: 900,
  overspend_amount: 0,
  note: "",
  created_at: "2026-05-18T10:00:00Z",
  card_id: null,
};

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

function renderCards(cards: unknown[], txns: Transaction[] = []) {
  mocks.useCreditCards.mockReturnValue({ cards, loading: false, reload: vi.fn() });
  mocks.usePageData.mockReturnValue({ profile: PROFILE, txns, loading: false, refresh: vi.fn() });
  return render(
    <ToastProvider>
      <CardsPage />
    </ToastProvider>
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.deleteCreditCard.mockResolvedValue(undefined);
  mocks.createCreditCard.mockResolvedValue({});
  mocks.updateCreditCard.mockResolvedValue({});
  mocks.payCardBill.mockResolvedValue({ outstanding: 7500 });
  mocks.payCreditCard.mockResolvedValue({ outstanding: 3000 });
  stubMatchMedia();
});

afterEach(() => {
  cleanup();
});

describe("cards page — multi-card view", () => {
  it("renders every card with its balances, limit and billing day", () => {
    renderCards([CARD_HDFC, CARD_SBI, CARD_ZERO]);
    expect(screen.getByText("HDFC Millennia")).toBeInTheDocument();
    expect(screen.getByText("SBI Cashback")).toBeInTheDocument();
    expect(screen.getByText("Amex Travel")).toBeInTheDocument();
    // Outstanding / available / limit are derived per card.
    expect(screen.getByText("₹12,500")).toBeInTheDocument();
    expect(screen.getByText("₹37,500")).toBeInTheDocument();
    expect(screen.getByText("₹8,000")).toBeInTheDocument();
    expect(screen.getByText("₹22,000")).toBeInTheDocument();
    expect(screen.getByText("₹50,000")).toBeInTheDocument();
    expect(screen.getByText("₹30,000")).toBeInTheDocument();
    // Billing day renders as its own inline span next to "Billing day".
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    // Each card has a billing-day row.
    expect(screen.getAllByText(/Billing day/)).toHaveLength(3);
    // Total outstanding across cards.
    expect(screen.getByText("₹20,500")).toBeInTheDocument();
  });

  it("shows a disabled 'No outstanding' state instead of a pay button", () => {
    renderCards([CARD_HDFC, CARD_SBI, CARD_ZERO]);
    const noOutstanding = screen.getByRole("button", { name: /no outstanding/i });
    expect(noOutstanding).toBeDisabled();
    expect(screen.getAllByRole("button", { name: /^pay bill$/i })).toHaveLength(2);
  });

  it("groups activity per card and keeps orphaned (non-card) activity visible", () => {
    const orphanPay: Transaction = {
      id: "txn-orphan-pay",
      user_id: "u1",
      type: "credit_card_payment",
      category: "Credit Card",
      subcategory: null,
      amount: 400,
      overspend_amount: 0,
      note: "salary",
      created_at: "2026-05-17T10:00:00Z",
      card_id: null,
    };
    renderCards([CARD_HDFC, CARD_SBI], [TXN_HDFC, TXN_ORPHAN, orphanPay]);
    expect(screen.getByText("HDFC Millennia activity")).toBeInTheDocument();
    expect(screen.getByText("Electronics")).toBeInTheDocument();
    expect(screen.getByText("Other card activity")).toBeInTheDocument();
    expect(screen.getByText("Dining")).toBeInTheDocument();
    // An empty card contributes no activity section.
    expect(screen.queryByText("SBI Cashback activity")).toBeNull();
  });
});

describe("cards page — pay a single card", () => {
  it("pays this card's bill through pay_card_bill and toasts the card name", async () => {
    renderCards([CARD_HDFC, CARD_SBI]);
    fireEvent.click(screen.getAllByRole("button", { name: /^pay bill$/i })[0]);

    // Sheet opens with the per-card subtitle.
    expect(screen.getByText(/12,500 outstanding · HDFC Millennia/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pay full ₹12,500/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /pay ₹5,000/i }));

    await waitFor(() => {
      expect(mocks.payCardBill).toHaveBeenCalledWith("hdfc-1", 5000, "salary");
    });
    expect(mocks.payCreditCard).not.toHaveBeenCalled();
    expect(await screen.findByText("Paid ₹5,000 toward HDFC Millennia.")).toBeInTheDocument();
    expect(mocks.emitRefresh).toHaveBeenCalled();
  });

  it("pays Card B without touching Card A", async () => {
    renderCards([CARD_HDFC, CARD_SBI]);
    fireEvent.click(screen.getAllByRole("button", { name: /^pay bill$/i })[1]);
    fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "8000" } });
    fireEvent.click(screen.getByRole("button", { name: /pay ₹8,000/i }));
    await waitFor(() => {
      expect(mocks.payCardBill).toHaveBeenCalledWith("sbi-1", 8000, "salary");
    });
  });
});

describe("cards page — add / edit / delete", () => {
  it("adds a card through the form and succeeds", async () => {
    renderCards([]);
    fireEvent.click(screen.getByRole("button", { name: /add credit card/i }));

    expect(screen.getByLabelText("Card name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^add card$/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Card name"), { target: { value: "Axis Flipkart" } });
    fireEvent.change(screen.getByLabelText("Credit limit"), { target: { value: "25000" } });
    fireEvent.change(screen.getByLabelText("Billing day"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: /^add card$/i }));

    await waitFor(() => {
      expect(mocks.createCreditCard).toHaveBeenCalledWith({
        name: "Axis Flipkart",
        creditLimit: 25000,
        billingDay: 20,
      });
    });
    expect(await screen.findByText("Card added.")).toBeInTheDocument();
  });

  it("validates the add form inline", async () => {
    renderCards([]);
    fireEvent.click(screen.getByRole("button", { name: /add credit card/i }));
    fireEvent.click(screen.getByRole("button", { name: /^add card$/i }));
    expect(await screen.findByText("Enter a card name.")).toBeInTheDocument();
    expect(mocks.createCreditCard).not.toHaveBeenCalled();
  });

  it("edits a card prefilled from its current values", async () => {
    renderCards([CARD_HDFC]);
    fireEvent.click(screen.getByRole("button", { name: "Edit HDFC Millennia" }));

    expect(screen.getByText("Edit card")).toBeInTheDocument();
    expect((screen.getByLabelText("Card name") as HTMLInputElement).value).toBe("HDFC Millennia");
    expect((screen.getByLabelText("Credit limit") as HTMLInputElement).value).toBe("50000");
    expect((screen.getByLabelText("Billing day") as HTMLInputElement).value).toBe("15");

    fireEvent.change(screen.getByLabelText("Credit limit"), { target: { value: "60000" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(mocks.updateCreditCard).toHaveBeenCalledWith("hdfc-1", {
        name: "HDFC Millennia",
        creditLimit: 60000,
        billingDay: 15,
      });
    });
    expect(await screen.findByText("Card updated.")).toBeInTheDocument();
  });

  it("asks for confirmation before deleting a card with history", async () => {
    renderCards([CARD_HDFC, CARD_SBI]);
    fireEvent.click(screen.getByRole("button", { name: "Delete SBI Cashback" }));

    expect(screen.getByText("Delete “SBI Cashback”?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(mocks.deleteCreditCard).toHaveBeenCalledWith("sbi-1");
    });
    expect(await screen.findByText("Card deleted.")).toBeInTheDocument();
  });

  it("cancelling the delete confirms nothing and deletes nothing", async () => {
    renderCards([CARD_HDFC]);
    fireEvent.click(screen.getByRole("button", { name: "Delete HDFC Millennia" }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByText(/can't be undone/i)).toBeNull();
    expect(mocks.deleteCreditCard).not.toHaveBeenCalled();
  });
});

describe("cards page — legacy account-wide view (no cards)", () => {
  it("keeps the original virtual-card experience when the user has no cards", () => {
    renderCards([]);
    expect(screen.getByText("FINSIGHT CARD")).toBeInTheDocument();
    expect(screen.getByText("No card charges yet")).toBeInTheDocument();
    expect(screen.queryByText(/outstanding bill/i)).toBeNull();
  });

  it("pays the account-wide outstanding through the legacy pay_credit_card", async () => {
    const legacy: Transaction[] = [
      {
        ...TXN_ORPHAN,
        id: "legacy-txn",
        amount: 5000,
        note: "flight",
        created_at: "2026-05-10T10:00:00Z",
      },
    ];
    renderCards([], legacy);
    expect(screen.getByText("FINSIGHT CARD")).toBeInTheDocument();
    expect(screen.getByText(/outstanding bill/i)).toBeInTheDocument();
    // "Spent this month" on the virtual card + the outstanding bill card.
    expect(screen.getAllByText("₹5,000").length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole("button", { name: /^pay bill$/i }));
    fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: /pay ₹2,000/i }));

    await waitFor(() => {
      expect(mocks.payCreditCard).toHaveBeenCalledWith(2000, "salary");
    });
    expect(mocks.payCardBill).not.toHaveBeenCalled();
    expect(await screen.findByText("Paid ₹2,000 toward your card bill.")).toBeInTheDocument();
  });
});