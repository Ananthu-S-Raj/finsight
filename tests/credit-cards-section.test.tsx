// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  useCreditCards: vi.fn(),
  payCardBill: vi.fn(),
  createCreditCard: vi.fn(),
}));

vi.mock("@/lib/cards", () => ({
  useCreditCards: mocks.useCreditCards,
  payCardBill: mocks.payCardBill,
  createCreditCard: mocks.createCreditCard,
  deleteCreditCard: vi.fn(),
  updateCreditCard: vi.fn(),
}));
vi.mock("@/lib/finance", () => ({ payCreditCard: vi.fn() }));
vi.mock("@/lib/events", () => ({ emitRefresh: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ haptic: vi.fn() }));
vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/PageHeader", () => ({
  default: () => null,
}));
vi.mock("@/components/ui/GlassCard", () => ({
  default: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

import CreditCardsSection from "@/components/CreditCardsSection";
import { ToastProvider } from "@/components/ui/ToastProvider";

const CARD_HDFC = {
  id: "hdfc-1",
  user_id: "u1",
  name: "HDFC Millennia",
  credit_limit: 50000,
  billing_day: 15,
  outstanding: 12500,
  available: 37500,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
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
  updated_at: "2026-03-01T00:00:00Z",
};

function stubMatchMedia() {
  (window as unknown as { matchMedia: () => unknown }).matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  (window as unknown as { visualViewport: unknown }).visualViewport = {
    height: 800,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

function renderSection(cards: unknown[] = []) {
  mocks.useCreditCards.mockReturnValue({ cards, loading: false, reload: vi.fn() });
  return render(
    <ToastProvider>
      <CreditCardsSection accountBalance={80000} savingsBalance={15000} />
    </ToastProvider>
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.payCardBill.mockResolvedValue({ outstanding: 7500 });
  mocks.createCreditCard.mockResolvedValue({});
  stubMatchMedia();
});

afterEach(() => {
  cleanup();
});

describe("CreditCardsSection — renders cards", () => {
  it("shows card name, outstanding and available when cards exist", () => {
    renderSection([CARD_HDFC]);
    expect(screen.getByText("HDFC Millennia")).toBeInTheDocument();
    expect(screen.getByText("₹12,500 owed · ₹37,500 available")).toBeInTheDocument();
  });

  it("shows total outstanding in the section header", () => {
    renderSection([CARD_HDFC]);
    expect(screen.getByText(/12,500 outstanding/)).toBeInTheDocument();
  });

  it("shows 'Clear' disabled button when outstanding is zero", () => {
    renderSection([CARD_ZERO]);
    const clear = screen.getByRole("button", { name: /clear/i });
    expect(clear).toBeDisabled();
  });

  it("shows 'Pay bill' button when outstanding > 0", () => {
    renderSection([CARD_HDFC]);
    expect(screen.getByRole("button", { name: /pay bill/i })).toBeEnabled();
  });

  it("shows 'Manage' link pointing to /cards", () => {
    renderSection([CARD_HDFC]);
    const link = screen.getByRole("link", { name: /manage/i });
    expect(link).toHaveAttribute("href", "/cards");
  });
});

describe("CreditCardsSection — empty state", () => {
  it("shows 'No cards yet' when no cards exist", () => {
    renderSection([]);
    expect(screen.getByText("No cards yet")).toBeInTheDocument();
  });

  it("shows the Add button when empty", () => {
    renderSection([]);
    expect(screen.getByRole("button", { name: /add credit card/i })).toBeInTheDocument();
  });

  it("opens CardFormSheet when Add is clicked", () => {
    renderSection([]);
    fireEvent.click(screen.getByRole("button", { name: /add credit card/i }));
    expect(screen.getByLabelText("Card name")).toBeInTheDocument();
  });
});

describe("CreditCardsSection — pay bill flow", () => {
  it("opens PayBillSheet with the correct card outstanding and card name", () => {
    renderSection([CARD_HDFC]);
    fireEvent.click(screen.getByRole("button", { name: /pay bill/i }));
    expect(screen.getByText(/12,500 outstanding · HDFC Millennia/i)).toBeInTheDocument();
  });

  it("submits the payment through payCardBill with correct card ID", async () => {
    renderSection([CARD_HDFC]);
    fireEvent.click(screen.getByRole("button", { name: /pay bill/i }));
    fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /pay ₹5,000/i }));
    await waitFor(() => {
      expect(mocks.payCardBill).toHaveBeenCalledWith("hdfc-1", 5000, "salary");
    });
  });
});

describe("CreditCardsSection — add credit card flow", () => {
  it("opens CardFormSheet from the empty-state Add button", () => {
    renderSection([]);
    fireEvent.click(screen.getByRole("button", { name: /add credit card/i }));
    expect(screen.getByLabelText("Card name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^add card$/i })).toBeInTheDocument();
  });

  it("opens CardFormSheet from the dashed 'Add credit card' row when cards exist", () => {
    renderSection([CARD_HDFC]);
    fireEvent.click(screen.getByRole("button", { name: /add credit card/i }));
    expect(screen.getByLabelText("Card name")).toBeInTheDocument();
  });
});
