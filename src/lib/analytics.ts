import { supabase } from "./supabaseClient";
import type { Profile, Transaction } from "./finance";

export type MonthBucket = {
  key: string;
  label: string;
  spent: number;
  income: number;
};

export type CategorySlice = {
  category: string;
  total: number;
  count: number;
  pct: number;
};

/** All time buckets (spent + income) for the trend chart, oldest → newest. */
export async function getMonthBuckets(userId: string, months = 8): Promise<MonthBucket[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("type, amount, created_at")
    .eq("user_id", userId);
  if (error) throw error;

  const buckets = new Map<string, MonthBucket>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, {
      key,
      label: d.toLocaleDateString("en-IN", { month: "short" }),
      spent: 0,
      income: 0,
    });
  }

  for (const row of data ?? []) {
    const d = new Date(row.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(key);
    if (!b) continue;
    const amount = Number(row.amount);
    if (row.type === "expense" || row.type === "credit_card") b.spent += amount;
    else if (row.type === "salary_add" || row.type === "loan_add") b.income += amount;
    else if (row.type === "savings_add") b.income += amount;
  }

  return [...buckets.values()];
}

/** Category breakdown for a given month. Returns null when empty. */
export async function getCategoryBreakdown(
  userId: string,
  ref = new Date()
): Promise<CategorySlice[] | null> {
  const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
  const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1));

  const { data, error } = await supabase
    .from("transactions")
    .select("category, amount")
    .eq("user_id", userId)
    .in("type", ["expense", "credit_card"])
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());
  if (error) throw error;

  const totals = new Map<string, { total: number; count: number }>();
  for (const row of data ?? []) {
    const cat = (row.category as string) || "Other";
    const cur = totals.get(cat) ?? { total: 0, count: 0 };
    cur.total += Number(row.amount);
    cur.count += 1;
    totals.set(cat, cur);
  }

  if (totals.size === 0) return null;

  const grand = [...totals.values()].reduce((s, v) => s + v.total, 0);
  return [...totals.entries()]
    .map(([category, v]) => ({
      category,
      total: v.total,
      count: v.count,
      pct: grand > 0 ? (v.total / grand) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

export async function getRecentMerchants(
  userId: string,
  limit = 8
): Promise<string[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("subcategory, created_at")
    .eq("user_id", userId)
    .in("type", ["expense", "credit_card"])
    .not("subcategory", "is", null)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) throw error;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of data ?? []) {
    const s = row.subcategory as string;
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export async function updateTransaction(
  userId: string,
  id: string,
  patch: Partial<Pick<Transaction, "category" | "subcategory" | "note">>
) {
  const { error } = await supabase
    .from("transactions")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function deleteTransaction(userId: string, id: string) {
  const { error } = await supabase
    .from("transactions")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function duplicateTransaction(userId: string, tx: Transaction) {
  const { error } = await supabase.from("transactions").insert({
    user_id: userId,
    type: tx.type,
    category: tx.category,
    subcategory: tx.subcategory,
    amount: tx.amount,
    overspend_amount: 0,
    note: tx.note,
  });
  if (error) throw error;
}
