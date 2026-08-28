import { supabase } from "./supabaseClient";

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  monthly_budget: number;
  salary_balance: number;
  savings_balance: number;
  /** ISO date (YYYY-MM-DD) or null when the user never set a birthday. */
  date_of_birth: string | null;
};

export type Transaction = {
  id: string;
  user_id: string;
  type:
    | "salary_add"
    | "savings_add"
    | "savings_move"
    | "expense"
    | "credit_card"
    | "loan_add";
  category: string | null;
  subcategory: string | null;
  amount: number;
  overspend_amount: number;
  note: string | null;
  created_at: string;
};

export const CATEGORY_PRESETS: Record<string, string[]> = {
  Travel: ["Bus", "Uber", "Rapido"],
  Food: ["Restaurants", "Zomato", "Swiggy"],
  Shopping: ["Shops", "Flipkart", "Amazon", "Myntra", "Meesho"],
  Other: ["Other expense"],
};

/**
 * Every balance-affecting write runs as an atomic SECURITY DEFINER RPC on
 * the server (row-locked), so concurrent tabs/devices cannot lose updates
 * and balances can never be driven negative. Direct table writes from the
 * client can no longer change protected columns (guarded in the database).
 */

export function rpcErrorMessage(err: { message?: string; code?: string; details?: string }): Error {
  if (process.env.NODE_ENV !== "production") {
    console.error("[FinSight RPC]", err);
  }
  switch (err.message) {
    case "insufficient_balance":
      return new Error("Not enough in your salary balance to cover that amount.");
    case "invalid_amount":
      return new Error("Amount must be greater than zero.");
    case "profile_not_found":
      return new Error("Account not found. Please sign out and back in.");
    case "invalid_kind":
      return new Error("That income type isn't supported.");
    case "category_invalid":
      return new Error("That category isn't available right now.");
    case "transaction_not_found":
      return new Error("That transaction doesn't exist or you don't have access.");
    default: {
      const hint = err.details ? ` (${err.details})` : "";
      return new Error(`FinSight couldn't save that right now.${hint}`);
    }
  }
}

export async function getProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function setMonthlyBudget(userId: string, amount: number) {
  const { error } = await supabase
    .from("profiles")
    .update({ monthly_budget: amount })
    .eq("id", userId);
  if (error) throw error;
}

export async function setDateOfBirth(userId: string, dateOfBirth: string | null) {
  const { error } = await supabase
    .from("profiles")
    .update({ date_of_birth: dateOfBirth })
    .eq("id", userId);
  if (error) throw error;
}

export async function addSalary(userId: string, amount: number, note = "") {
  const { error } = await supabase.rpc("apply_income", {
    p_kind: "salary",
    p_amount: amount,
    p_note: note,
  });
  if (error) throw rpcErrorMessage(error);
}

export async function addLoan(userId: string, amount: number, source: string) {
  const { error } = await supabase.rpc("apply_income", {
    p_kind: "loan",
    p_amount: amount,
    p_note: source,
  });
  if (error) throw rpcErrorMessage(error);
}

export async function addSavingsDirect(userId: string, amount: number, note = "") {
  const { error } = await supabase.rpc("apply_income", {
    p_kind: "savings",
    p_amount: amount,
    p_note: note,
  });
  if (error) throw rpcErrorMessage(error);
}

export async function moveToSavings(userId: string, amount: number) {
  const { error } = await supabase.rpc("apply_savings_move", {
    p_amount: amount,
  });
  if (error) throw rpcErrorMessage(error);
}

/**
 * Records a spend (cash/UPI expense or credit card charge) against a category
 * preset. The overspill-over-budget amount is deducted from the salary balance
 * server-side and reported so the UI can raise an overspending alert. If the
 * salary balance cannot cover the overspend the RPC rejects it (no negative
 * balances are ever produced).
 */
export async function recordSpend(
  userId: string,
  opts: {
    category: string;
    subcategory: string;
    amount: number;
    note?: string;
    isCreditCard?: boolean;
  }
): Promise<{ overspendAmount: number }> {
  const { data, error } = await supabase.rpc("apply_expense", {
    p_category: opts.category,
    p_subcategory: opts.subcategory,
    p_amount: opts.amount,
    p_note: opts.note ?? "",
    p_is_credit_card: opts.isCreditCard ?? false,
  });
  if (error) throw rpcErrorMessage(error);
  return { overspendAmount: Number((data as { overspend_amount?: number })?.overspend_amount ?? 0) };
}

export async function getRecentTransactions(
  userId: string,
  limit = 25
): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Transaction[];
}

async function monthSpentSoFar(userId: string): Promise<number> {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );

  const { data, error } = await supabase
    .from("transactions")
    .select("amount")
    .eq("user_id", userId)
    .in("type", ["expense", "credit_card"])
    .gte("created_at", start.toISOString());
  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
}

export async function getMonthSummary(userId: string, monthlyBudget?: number) {
  const spent = await monthSpentSoFar(userId);
  // When the caller already has the profile (e.g. usePageData's Promise.all),
  // pass monthlyBudget to avoid a redundant getProfile round-trip.
  const budget = monthlyBudget ?? (await getProfile(userId)).monthly_budget;
  return {
    spent,
    budget,
    remaining: budget - spent,
    isOverspent: spent > budget,
  };
}
