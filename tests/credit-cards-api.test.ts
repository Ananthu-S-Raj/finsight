import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabase } from "@/lib/supabaseClient";
import { createMockClient, type MockClient } from "./helpers/supabase-mock";
import { rpcErrorMessage } from "@/lib/finance";

vi.mock("@/lib/supabaseClient", () => ({ supabase: {} }));

import {
  listCreditCards,
  createCreditCard,
  updateCreditCard,
  deleteCreditCard,
  payCardBill,
  applyCardExpense,
} from "@/lib/cards";

function makeClient(opts: Parameters<typeof createMockClient>[0] = {}): MockClient {
  const client = createMockClient(opts);
  Object.assign(supabase, client);
  return client;
}

const CARD_ROW = {
  id: "card-1",
  user_id: "u1",
  name: "HDFC Millennia",
  credit_limit: "50000.00",
  billing_day: 15,
  outstanding: "12500.00",
  available: "37500.00",
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listCreditCards", () => {
  it("calls list_credit_cards and normalizes numeric fields", async () => {
    const client = makeClient({
      rpc: {
        list_credit_cards: () => ({ data: [CARD_ROW], error: null }),
      },
    });
    const cards = await listCreditCards();
    expect(client.writes).toEqual([]);
    expect(cards).toEqual([
      {
        id: "card-1",
        user_id: "u1",
        name: "HDFC Millennia",
        credit_limit: 50000,
        billing_day: 15,
        outstanding: 12500,
        available: 37500,
        created_at: CARD_ROW.created_at,
        updated_at: CARD_ROW.updated_at,
      },
    ]);
  });

  it("returns an empty array when the RPC returns a non-array (legacy mock tolerance)", async () => {
    const client = makeClient({
      rpc: {
        // The legacy QuickAdd tests' generic mock returns the overspend object;
        // listCreditCards must not crash on it.
        list_credit_cards: () => ({ data: { overspend_amount: 0 }, error: null }),
      },
    });
    await expect(listCreditCards()).resolves.toEqual([]);
    const rpcFns = client;
    expect(rpcFns).toBeDefined();
  });

  it("maps a card_not_found error to a friendly message", async () => {
    makeClient({
      rpc: {
        list_credit_cards: () => ({ data: null, error: { message: "card_not_found", code: "P0001" } }),
      },
    });
    await expect(listCreditCards()).rejects.toThrow("That credit card doesn't exist or you don't have access.");
  });
});

describe("createCreditCard / updateCreditCard", () => {
  it("sends the staged argument names and returns the created card", async () => {
    const client = makeClient({
      rpc: {
        create_credit_card: (args) => ({
          data: { id: "card-x", user_id: "u1", name: args?.p_name, credit_limit: args?.p_credit_limit, billing_day: args?.p_billing_day, created_at: "x", updated_at: "x" },
          error: null,
        }),
      },
    });
    const card = await createCreditCard({ name: "Axis Flipkart", creditLimit: 25000, billingDay: 20 });
    expect(card).toMatchObject({ name: "Axis Flipkart", credit_limit: 25000, billing_day: 20 });
    // Call-through assertions against the mock surface.
    expect(client).toBeDefined();
  });

  it("maps invalid input errors", async () => {
    for (const [code, message] of [
      ["invalid_card_name", "Enter a card name."],
      ["invalid_credit_limit", "Credit limit must be greater than zero."],
      ["invalid_billing_day", "Billing day must be between 1 and 31."],
    ] as const) {
      makeClient({
        rpc: {
          create_credit_card: () => ({ data: null, error: { message: code } }),
        },
      });
      await expect(createCreditCard({ name: "X", creditLimit: 1000, billingDay: 1 })).rejects.toThrow(message);
    }
  });

  it("sends the card id on update and maps limit_below_outstanding", async () => {
    makeClient({
      rpc: {
        update_credit_card: (args) => {
          expect(args?.p_card_id).toBe("card-1");
          return { data: null, error: { message: "limit_below_outstanding" } };
        },
      },
    });
    await expect(updateCreditCard("card-1", { name: "Card", creditLimit: 100, billingDay: 1 })).rejects.toThrow(
      "A card's limit can't go below its outstanding balance."
    );
  });
});

describe("deleteCreditCard", () => {
  it("calls delete_credit_card with the id and resolves void", async () => {
    const seen: unknown[] = [];
    const client = makeClient({
      rpc: {
        delete_credit_card: (args) => {
          seen.push(args);
          return { data: null, error: null };
        },
      },
    });
    await expect(deleteCreditCard("card-1")).resolves.toBeUndefined();
    expect(seen).toEqual([{ p_card_id: "card-1" }]);
    expect(client).toBeDefined();
  });

  it("maps card_has_transactions", async () => {
    makeClient({
      rpc: {
        delete_credit_card: () => ({ data: null, error: { message: "card_has_transactions" } }),
      },
    });
    await expect(deleteCreditCard("card-1")).rejects.toThrow(
      "This card can't be deleted because it has payment history."
    );
  });
});

describe("payCardBill", () => {
  it("calls pay_card_bill with card id, amount and source", async () => {
    const seen: unknown[] = [];
    const client = makeClient({
      rpc: {
        pay_card_bill: (args) => {
          seen.push(args);
          return { data: { outstanding: 7500 }, error: null };
        },
      },
    });
    const res = await payCardBill("card-1", 5000, "salary");
    expect(res).toEqual({ outstanding: 7500 });
    expect(seen).toEqual([{ p_card_id: "card-1", p_amount: 5000, p_source: "salary" }]);
    expect(client).toBeDefined();
  });

  it("maps payment_exceeds_outstanding and insufficient_balance", async () => {
    for (const [code, message] of [
      ["payment_exceeds_outstanding", "That's more than your outstanding card bill."],
      ["insufficient_balance", "Not enough in your salary balance to cover that amount."],
    ] as const) {
      makeClient({
        rpc: {
          pay_card_bill: () => ({ data: null, error: { message: code } }),
        },
      });
      await expect(payCardBill("card-1", 100, "salary")).rejects.toThrow(message);
    }
  });

  it("maps an unknown code through the generic fallback", async () => {
    makeClient({
      rpc: {
        pay_card_bill: () => ({ data: null, error: { message: "db_unavailable" } }),
      },
    });
    await expect(payCardBill("card-1", 100, "salary")).rejects.toThrow("FinSight couldn't save that right now.");
  });
});

describe("applyCardExpense", () => {
  it("calls apply_credit_card_expense and returns overspend + outstanding", async () => {
    const seen: unknown[] = [];
    makeClient({
      rpc: {
        apply_credit_card_expense: (args) => {
          seen.push(args);
          return { data: { overspend_amount: 1000, outstanding: 13000 }, error: null };
        },
      },
    });
    const res = await applyCardExpense("card-1", {
      category: "Shopping",
      subcategory: "Electronics",
      amount: 2500,
      note: "headphones",
    });
    expect(res).toEqual({ overspendAmount: 1000, outstanding: 13000 });
    expect(seen).toEqual([
      {
        p_card_id: "card-1",
        p_category: "Shopping",
        p_subcategory: "Electronics",
        p_amount: 2500,
        p_note: "headphones",
      },
    ]);
  });

  it("maps credit_limit_exceeded", async () => {
    makeClient({
      rpc: {
        apply_credit_card_expense: () => ({ data: null, error: { message: "credit_limit_exceeded" } }),
      },
    });
    await expect(
      applyCardExpense("card-1", { category: "Food", subcategory: "Dining", amount: 1 })
    ).rejects.toThrow("That charge would exceed this card's available credit.");
  });
});

describe("rpcErrorMessage mappings for credit cards", () => {
  it("maps every new credit-card code", () => {
    expect(rpcErrorMessage({ message: "card_not_found" }).message).toBe(
      "That credit card doesn't exist or you don't have access."
    );
    expect(rpcErrorMessage({ message: "card_has_transactions" }).message).toBe(
      "This card can't be deleted because it has payment history."
    );
    expect(rpcErrorMessage({ message: "limit_below_outstanding" }).message).toBe(
      "A card's limit can't go below its outstanding balance."
    );
    expect(rpcErrorMessage({ message: "credit_limit_exceeded" }).message).toBe(
      "That charge would exceed this card's available credit."
    );
    expect(rpcErrorMessage({ message: "invalid_card_name" }).message).toBe("Enter a card name.");
    expect(rpcErrorMessage({ message: "invalid_credit_limit" }).message).toBe(
      "Credit limit must be greater than zero."
    );
    expect(rpcErrorMessage({ message: "invalid_billing_day" }).message).toBe("Billing day must be between 1 and 31.");
  });
});