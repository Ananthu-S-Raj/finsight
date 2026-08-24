import { loadAIConfig, type AIProviderName } from "./config";
import { AIError, DEFAULT_AI_FALLBACK, type AIFailureKind } from "./errors";
import { getProvider } from "./provider";
import { AI_SYSTEM_PROMPT, buildInsightsPrompt, sanitizeCategory, type InsightSummary } from "./prompts";

export interface TransactionRow {
  id: string;
  type: string;
  amount: number;
  category?: string | null;
  subcategory?: string | null;
  created_at: string;
}

export type InsightsResult =
  | {
      available: true;
      insights: string;
      provider: AIProviderName;
      model: string;
      latencyMs: number;
      fromCache: boolean;
    }
  | { available: false; code: AIFailureKind; message: string };

const INCOME_TYPES = new Set(["salary_add", "loan_add", "savings_add"]);
const SPEND_TYPES = new Set(["expense", "credit_card"]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pct(part: number, total: number): number {
  return total > 0 ? round2((part / total) * 100) : 0;
}

function monthLabelFor(month: string): string {
  const [y, m] = month.split("-").map((n) => Number(n));
  if (!y || !m || m < 1 || m > 12) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

/**
 * Privacy-preserving aggregation. Only these numbers ever leave the server —
 * no notes, no subcategories, no identifiers, no transaction rows.
 */
export function aggregateInsights(
  txns: TransactionRow[],
  month: string,
  budget: number | null,
): InsightSummary {
  const inMonth = txns.filter((t) => (t.created_at ?? "").slice(0, 7) === month);

  let income = 0;
  let totalSpent = 0;
  const categoryTotals = new Map<string, number>();

  for (const t of inMonth) {
    const amount = Number(t.amount) || 0;
    if (INCOME_TYPES.has(t.type)) income += amount;
    else if (SPEND_TYPES.has(t.type)) {
      totalSpent += amount;
      const cat = sanitizeCategory(t.category ?? "");
      categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + amount);
    }
  }

  income = round2(income);
  totalSpent = round2(totalSpent);

  const topCategories = [...categoryTotals.entries()]
    .map(([category, amount]) => ({
      category,
      amount: round2(amount),
      pct: pct(amount, totalSpent),
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  return {
    monthLabel: monthLabelFor(month),
    transactionCount: inMonth.length,
    income,
    totalSpent,
    budget: budget !== null && budget !== undefined ? round2(Number(budget)) : null,
    budgetUsedPct: budget && budget > 0 ? pct(totalSpent, budget) : null,
    topCategories,
    savingsRate: income > 0 ? round2(((income - totalSpent) / income) * 100) : null,
  };
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const insightsCache = new Map<string, { expiresAt: number; result: InsightsResult }>();

/** Test hook — resets the in-memory result cache. */
export function clearInsightsCache(): void {
  insightsCache.clear();
}

export async function generateInsights(
  txns: TransactionRow[],
  opts: { month: string; budget: number | null },
): Promise<InsightsResult> {
  const config = loadAIConfig();
  if (!config.enabled) {
    return { available: false, code: "not_configured", message: DEFAULT_AI_FALLBACK };
  }

  const provider = getProvider(config);
  if (!provider) {
    return { available: false, code: "not_configured", message: DEFAULT_AI_FALLBACK };
  }

  const summary = aggregateInsights(txns, opts.month, opts.budget);
  const cacheKey = `${config.provider}:${provider.model}:${opts.month}:${JSON.stringify(summary)}`;
  const cached = insightsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const prompt = buildInsightsPrompt(summary);
  const now = Date.now();

  try {
    const completion = await provider.complete(AI_SYSTEM_PROMPT, prompt);
    const result: InsightsResult = {
      available: true,
      insights: completion.text,
      provider: completion.provider,
      model: completion.model,
      latencyMs: completion.latencyMs,
      fromCache: false,
    };
    insightsCache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, result });
    return result;
  } catch (err) {
    const kind: AIFailureKind = err instanceof AIError ? err.kind : "server_error";
    const message = err instanceof AIError ? err.userMessage : DEFAULT_AI_FALLBACK;
    return { available: false, code: kind, message };
  }
}
