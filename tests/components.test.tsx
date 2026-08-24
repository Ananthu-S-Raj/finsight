// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import PasswordStrength from "@/components/PasswordStrength";
import Toggle from "@/components/ui/Toggle";
import Button from "@/components/ui/Button";
import { PrivateValue, EyeToggle, useBalanceHidden } from "@/components/ui/BalanceVisibility";
import TransactionRow, {
  TXN_LABEL,
  txTitle,
  txSubtitle,
  TXN_SIGN,
} from "@/components/TransactionRow";
import type { Transaction } from "@/lib/finance";
import { makeSalaryTx, makeTransaction, makeSavingsMoveTx, makeCreditCardTx } from "./helpers/fixtures";

vi.mock("@/lib/haptics", () => ({
  haptic: vi.fn(),
}));
import { haptic } from "@/lib/haptics";

function tx(over: Partial<Transaction> = {}): Transaction {
  return { id: 1, user_id: "u1", amount: 1200, type: "expense", category: "Food", subcategory: null, note: null, created_at: "2026-08-11T10:00:00.000Z", overspend_amount: 0, ...over } as Transaction;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("PasswordStrength", () => {
  it("shows no label when the password is empty and none of the bars are filled", () => {
    render(<PasswordStrength password="" />);
    const meter = document.querySelector('div[aria-hidden="true"]');
    expect(meter).not.toBeNull();
    expect(screen.queryByText(/weak|fair|good|strong/i)).not.toBeInTheDocument();
  });

  it("lists all four requirements and marks them unmet for a weak password", () => {
    render(<PasswordStrength password="abc" />);
    expect(screen.getByText("At least 8 characters")).toBeInTheDocument();
    expect(screen.getByText("At least one uppercase letter")).toBeInTheDocument();
    expect(screen.getByText("At least one lowercase letter")).toBeInTheDocument();
    expect(screen.getByText("At least one number")).toBeInTheDocument();
  });

  it("marks every requirement as met for a strong password", () => {
    render(<PasswordStrength password="Abcdefg1" />);
    const checkmarks = document.querySelectorAll("span");
    const filled = [...checkmarks].filter((el) => el.textContent === "✓");
    expect(filled.length).toBe(4);
  });
});

describe("Toggle", () => {
  it("is a switch with aria-checked reflecting state", () => {
    render(<Toggle on label="Sound" onChange={() => {}} />);
    const btn = screen.getByRole("switch", { name: "Sound" });
    expect(btn).toHaveAttribute("aria-checked", "true");
    expect(btn).toHaveAttribute("data-on", "true");
  });

  it("flips the value through onChange on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle on={false} label="Sound" onChange={onChange} />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(haptic).toHaveBeenCalledWith("toggle");
  });

  it("is inert when disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle on label="Sound" disabled onChange={onChange} />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("PrivateValue / EyeToggle / useBalanceHidden", () => {
  it("formats the value with ₹ when visible and keeps it in the a11y tree", () => {
    render(<PrivateValue value={1200} hidden={false} />);
    expect(screen.getByText(/₹1,200/)).toBeInTheDocument();
  });

  it("blurs and masks the amount, hiding the real figure from assistive tech", () => {
    render(<PrivateValue value={1200} hidden />);
    const el = screen.getByText(/masked|₹/i).closest("span");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveStyle({ filter: "blur(9px)" });
    expect(screen.queryByText(/₹1,200/)).not.toBeInTheDocument();
  });

  it("EyeToggle toggles hidden state and announces intent", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EyeToggle hidden onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Show balance" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Show balance" }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("persists the hidden flag to localStorage", () => {
    function Harness() {
      const [hidden, setHidden] = useBalanceHidden();
      return <button onClick={() => setHidden(!hidden)}>{String(hidden)}</button>;
    }
    render(<Harness />);
    expect(localStorage.getItem("finsight:hide-balances")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(localStorage.getItem("finsight:hide-balances")).toBe("1");
  });
});

describe("Button", () => {
  it("renders children and fires onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("maps variant to the expected class", () => {
    const { rerender } = render(<Button variant="primary">Go</Button>);
    expect(screen.getByRole("button")).toHaveClass("btn-primary");
    rerender(<Button variant="ghost">Go</Button>);
    expect(screen.getByRole("button")).toHaveClass("btn-ghost");
    rerender(<Button variant="danger">Go</Button>);
    expect(screen.getByRole("button")).toHaveClass("btn-danger");
    rerender(<Button variant="neo">Go</Button>);
    expect(screen.getByRole("button")).toHaveClass("neo");
  });

  it("fires haptic feedback only when vibrate is set", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Quiet</Button>);
    await user.click(screen.getByRole("button"));
    expect(haptic).not.toHaveBeenCalled();
    render(<Button onClick={onClick} vibrate>Buzz</Button>);
    await user.click(screen.getByRole("button", { name: "Buzz" }));
    expect(haptic).toHaveBeenCalledWith("toggle");
  });

  it("respects disabled and type attributes", () => {
    render(
      <Button disabled type="submit">
        Send
      </Button>
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("type", "submit");
  });
});

describe("TransactionRow helpers", () => {
  it("derives friendly titles for each transaction kind", () => {
    expect(txTitle(makeSalaryTx({ note: "July pay" }))).toContain("Salary added");
    expect(txTitle(makeTransaction({ subcategory: "Groceries" }))).toBe("Groceries");
    expect(txTitle(makeTransaction({ category: "Food", subcategory: null, note: null }))).toBe("Food");
    expect(txTitle(makeSavingsMoveTx())).toBe("Moved to savings");
    expect(txTitle(makeCreditCardTx({ category: "Bills", subcategory: null }))).toBe("Bills");
  });

  it("keeps plus/minus signage in sync with the type", () => {
    expect(TXN_SIGN.salary_add).toBe("+");
    expect(TXN_SIGN.expense).toBe("-");
    expect(TXN_SIGN.savings_move).toBe("-");
  });

  it("builds a descriptive subtitle", () => {
    expect(txSubtitle(makeTransaction({ category: "Food", note: "lunch" }))).toBe("Food · lunch");
    expect(txSubtitle(makeSavingsMoveTx())).toBe("salary → savings");
  });
});

describe("TransactionRow rendering", () => {
  it("shows the title, formatted amount and signed value", () => {
    render(<TransactionRow tx={tx()} onOpen={() => {}} />);
    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.getByText("-₹1,200")).toBeInTheDocument();
  });

  it("flags overspent rows", () => {
    render(<TransactionRow tx={tx({ overspend_amount: 500 })} />);
    expect(screen.getByText(/overspent/i)).toBeInTheDocument();
  });

  it("does not flag rows without overspend", () => {
    render(<TransactionRow tx={tx()} />);
    expect(screen.queryByText(/overspent/i)).not.toBeInTheDocument();
  });

  it("opens the detail view when the row is clicked", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const row = tx();
    render(<TransactionRow tx={row} onOpen={onOpen} />);
    await user.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith(row);
  });

  it("renders the correct label for income rows", () => {
    render(<TransactionRow tx={makeSalaryTx({ amount: 50000 })} />);
    // "Salary added" appears in both the row title and the subtitle.
    expect(screen.getAllByText(/Salary added/i).length).toBeGreaterThan(0);
    expect(screen.getByText("+₹50,000")).toBeInTheDocument();
  });
});
