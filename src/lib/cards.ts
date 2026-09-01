"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { rpcErrorMessage } from "./finance";
import { listenRefresh } from "./events";

/**
 * A credit card as stored in the ledger. Balances are never stored on the
 * row: outstanding and available credit are derived per card by the
 * list_credit_cards RPC so they can never drift from transaction history.
 */
export type CreditCard = {
  id: string;
  user_id: string;
  name: string;
  credit_limit: number;
  billing_day: number;
  created_at: string;
  updated_at: string;
};

export type CreditCardWithBalance = CreditCard & {
  outstanding: number;
  available: number;
};

export type CreditCardInput = {
  name: string;
  creditLimit: number;
  billingDay: number;
};

function asBalancedCards(data: unknown): CreditCardWithBalance[] {
  if (!Array.isArray(data)) return [];
  return (data as CreditCardWithBalance[]).map((c) => ({
    ...c,
    credit_limit: Number(c.credit_limit),
    outstanding: Number(c.outstanding),
    available: Number(c.available),
    billing_day: Number(c.billing_day),
  }));
}

export async function listCreditCards(): Promise<CreditCardWithBalance[]> {
  const { data, error } = await supabase.rpc("list_credit_cards");
  if (error) throw rpcErrorMessage(error);
  return asBalancedCards(data);
}

export async function createCreditCard(input: CreditCardInput): Promise<CreditCard> {
  const { data, error } = await supabase.rpc("create_credit_card", {
    p_name: input.name,
    p_credit_limit: input.creditLimit,
    p_billing_day: input.billingDay,
  });
  if (error) throw rpcErrorMessage(error);
  return (data ?? {}) as CreditCard;
}

export async function updateCreditCard(
  cardId: string,
  input: CreditCardInput
): Promise<CreditCard> {
  const { data, error } = await supabase.rpc("update_credit_card", {
    p_card_id: cardId,
    p_name: input.name,
    p_credit_limit: input.creditLimit,
    p_billing_day: input.billingDay,
  });
  if (error) throw rpcErrorMessage(error);
  return (data ?? {}) as CreditCard;
}

export async function deleteCreditCard(cardId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_credit_card", { p_card_id: cardId });
  if (error) throw rpcErrorMessage(error);
}

/**
 * Pays down a single card's bill from the chosen source ('salary' = account
 * balance, 'savings'), atomically server-side. Never more than that card's
 * outstanding.
 */
export async function payCardBill(
  cardId: string,
  amount: number,
  source: "salary" | "savings"
): Promise<{ outstanding: number }> {
  const { data, error } = await supabase.rpc("pay_card_bill", {
    p_card_id: cardId,
    p_amount: amount,
    p_source: source,
  });
  if (error) throw rpcErrorMessage(error);
  return { outstanding: Number((data as { outstanding?: number })?.outstanding ?? 0) };
}

/**
 * Charges a purchase to a specific card. Never touches the salary balance;
 * returns the over-budget excess so the existing "over budget" toast works.
 */
export async function applyCardExpense(
  cardId: string,
  opts: { category: string; subcategory: string; amount: number; note?: string }
): Promise<{ overspendAmount: number; outstanding: number }> {
  const { data, error } = await supabase.rpc("apply_credit_card_expense", {
    p_card_id: cardId,
    p_category: opts.category,
    p_subcategory: opts.subcategory,
    p_amount: opts.amount,
    p_note: opts.note ?? "",
  });
  if (error) throw rpcErrorMessage(error);
  return {
    overspendAmount: Number((data as { overspend_amount?: number })?.overspend_amount ?? 0),
    outstanding: Number((data as { outstanding?: number })?.outstanding ?? 0),
  };
}

/**
 * Loads the caller's cards, reloading whenever any mutation fires the app-wide
 * refresh event (so paying/edit cards elsewhere keeps every view in sync).
 */
export function useCreditCards() {
  const [cards, setCards] = useState<CreditCardWithBalance[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const data = await listCreditCards();
      setCards(data);
      return data;
    } catch {
      setCards([]);
      return [] as CreditCardWithBalance[];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    return listenRefresh(reload);
  }, [reload]);

  return { cards, loading, reload };
}