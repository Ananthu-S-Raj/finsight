import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAIConfig } from "@/lib/ai/config";
import { OpenAIProvider, OllamaProvider } from "@/lib/ai/provider";
import { aggregateInsights, clearInsightsCache, generateInsights } from "@/lib/ai/service";
import { createMockClient, type MockQueryOptions } from "./helpers/supabase-mock";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
import { createClient } from "@supabase/supabase-js";

import { POST as aiInsightsPOST } from "@/app/api/v1/ai/insights/route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const USER_EMAIL = "user@example.com";
const AUGUST = "2026-08";

const ENV_KEYS = [
  "AI_ENABLED",
  "AI_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_BASE_URL",
  "OPENAI_TIMEOUT_MS",
  "OLLAMA_ENABLED",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  "OLLAMA_TIMEOUT_MS",
];

function setEnv(values: Record<string, string>) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

function tx(type: string, amount: number, day: number, category: string, note = "", subcategory = "") {
  return {
    id: `tx-${type}-${day}-${amount}`,
    type,
    amount,
    category,
    subcategory,
    note,
    created_at: `${AUGUST}-${String(day).padStart(2, "0")}T10:00:00.000Z`,
  };
}

function sampleTxns() {
  return [
    tx("salary_add", 50000, 1, "", "confidential salary note"),
    tx("expense", 1500, 2, "Food", "pizza at 14 secret road"),
    tx("credit_card", 3500, 3, "Groceries", "note should never leave server"),
    tx("expense", 800, 4, "Transport"),
    tx("savings_move", 5000, 5, "Savings", "internal transfer"),
    {
      id: "tx-out-month",
      type: "expense",
      amount: 200,
      category: "Food",
      subcategory: "",
      note: "outside-month data",
      created_at: "2026-09-01T10:00:00.000Z",
    },
  ];
}

function makeClient(opts: MockQueryOptions = {}): ReturnType<typeof createMockClient> {
  const profiles = [{ id: USER_ID, email: USER_EMAIL, monthly_budget: 10000 }];
  return createMockClient({
    user: { id: USER_ID, email: USER_EMAIL },
    tables: { profiles, transactions: sampleTxns() },
    ...opts,
  });
}

function fetchResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function openAIResponse(text: string): Response {
  return fetchResponse(200, { choices: [{ message: { role: "assistant", content: text } }] });
}

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  clearInsightsCache();
  setEnv({
    AI_ENABLED: "true",
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
    OPENAI_MODEL: "gpt-4o-mini",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    OPENAI_TIMEOUT_MS: "15000",
  });
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("AI config (environment only)", () => {
  it("defaults sensibly when no AI env vars are set", () => {
    setEnv({});
    const cfg = loadAIConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.provider).toBe("openai");
    expect(cfg.openai.apiKey).toBe("");
    expect(cfg.openai.model).toBe("gpt-4o-mini");
    expect(cfg.ollama.enabled).toBe(false);
  });

  it("honours AI_ENABLED=false and the provider switch", () => {
    setEnv({ AI_ENABLED: "false", AI_PROVIDER: "ollama", OLLAMA_ENABLED: "true" });
    const cfg = loadAIConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.provider).toBe("ollama");
    expect(cfg.ollama.enabled).toBe(true);
  });

  it("rejects non-positive timeouts, falling back to defaults", () => {
    setEnv({ OPENAI_TIMEOUT_MS: "-5", OLLAMA_TIMEOUT_MS: "abc" });
    const cfg = loadAIConfig();
    expect(cfg.openai.timeoutMs).toBe(15000);
    expect(cfg.ollama.timeoutMs).toBe(30000);
  });
});

describe("aggregateInsights (privacy-filtered summary)", () => {
  it("computes income, spend, top categories, budget and savings rate", () => {
    const summary = aggregateInsights(sampleTxns(), AUGUST, 10000);
    expect(summary.transactionCount).toBe(5);
    expect(summary.income).toBe(50000);
    expect(summary.totalSpent).toBe(5800);
    expect(summary.budget).toBe(10000);
    expect(summary.budgetUsedPct).toBe(58);
    expect(summary.savingsRate).toBe(88.4);
    expect(summary.topCategories[0]).toEqual({ category: "Groceries", amount: 3500, pct: 60.34 });
  });

  it("excludes savings transfers from spending and ignores other months", () => {
    const summary = aggregateInsights(sampleTxns(), AUGUST, null);
    expect(summary.totalSpent).toBe(5800);
    expect(summary.budget).toBeNull();
    expect(summary.budgetUsedPct).toBeNull();
  });
});

describe("OpenAI provider", () => {
  it("sends system + user messages and returns content", async () => {
    fetchMock.mockResolvedValue(openAIResponse("You spent most on groceries."));
    const provider = new OpenAIProvider(loadAIConfig().openai);
    const result = await provider.complete("sys", "user data");
    expect(result.text).toBe("You spent most on groceries.");
    expect(result.provider).toBe("openai");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "user data" },
    ]);
  });

  it("throws auth on 401 and never includes the raw body in the message", async () => {
    fetchMock.mockResolvedValue(fetchResponse(401, { error: { message: "Invalid API key" } }));
    const provider = new OpenAIProvider(loadAIConfig().openai);
    await expect(provider.complete("s", "u")).rejects.toMatchObject({ kind: "auth" });
  });

  it("maps 429, 5xx and empty content to the right kinds", async () => {
    const provider = new OpenAIProvider(loadAIConfig().openai);
    fetchMock.mockResolvedValue(fetchResponse(429, { error: {} }));
    await expect(provider.complete("s", "u")).rejects.toMatchObject({ kind: "rate_limited" });
    fetchMock.mockResolvedValue(fetchResponse(503, { error: {} }));
    await expect(provider.complete("s", "u")).rejects.toMatchObject({ kind: "server_error" });
    fetchMock.mockResolvedValue(fetchResponse(200, { choices: [{ message: { content: "" } }] }));
    await expect(provider.complete("s", "u")).rejects.toMatchObject({ kind: "empty" });
  });

  it("maps a timeout to kind timeout", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const provider = new OpenAIProvider(loadAIConfig().openai);
    await expect(provider.complete("s", "u")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("maps a network failure to kind network", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const provider = new OpenAIProvider(loadAIConfig().openai);
    await expect(provider.complete("s", "u")).rejects.toMatchObject({ kind: "network" });
  });
});

describe("Ollama provider", () => {
  it("is unconfigured unless explicitly enabled", () => {
    const cfg = loadAIConfig();
    expect(new OllamaProvider(cfg.ollama).isConfigured()).toBe(false);
    setEnv({ OLLAMA_ENABLED: "true", OLLAMA_BASE_URL: "http://ollama:11434" });
    expect(new OllamaProvider(loadAIConfig().ollama).isConfigured()).toBe(true);
  });

  it("reports unreachable ping when the server is down", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const provider = new OllamaProvider(loadAIConfig().ollama);
    const ping = await provider.ping();
    expect(ping.reachable).toBe(false);
    expect(ping.detail).toBe("unreachable");
  });
});

describe("generateInsights (service)", () => {
  it("falls back cleanly when AI is disabled", async () => {
    setEnv({ AI_ENABLED: "false" });
    const result = await generateInsights(sampleTxns(), { month: AUGUST, budget: 10000 });
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.code).toBe("not_configured");
      expect(result.message).toContain("unavailable");
    }
  });

  it("falls back when no provider is configured (no API key)", async () => {
    setEnv({ OPENAI_API_KEY: "" });
    const result = await generateInsights(sampleTxns(), { month: AUGUST, budget: 10000 });
    expect(result.available).toBe(false);
  });

  it("returns provider text on success", async () => {
    fetchMock.mockResolvedValue(openAIResponse("August: you spent ₹5,800."));
    const result = await generateInsights(sampleTxns(), { month: AUGUST, budget: 10000 });
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.insights).toBe("August: you spent ₹5,800.");
      expect(result.provider).toBe("openai");
      expect(result.model).toBe("gpt-4o-mini");
    }
  });

  it("returns a friendly fallback (not the raw error) on provider failure", async () => {
    fetchMock.mockResolvedValue(fetchResponse(500, { error: { message: "gpu exploded: <secret>" } }));
    const result = await generateInsights(sampleTxns(), { month: AUGUST, budget: 10000 });
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.code).toBe("server_error");
      expect(result.message).not.toContain("secret");
      expect(result.message).not.toContain("gpu");
    }
  });

  it("never sends notes, subcategories, ids, emails or transaction rows to the provider", async () => {
    fetchMock.mockResolvedValue(openAIResponse("ok"));
    await generateInsights(sampleTxns(), { month: AUGUST, budget: 10000 });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { messages: { role: string; content: string }[] };
    const userPrompt = body.messages.find((m) => m.role === "user")!.content;

    expect(userPrompt).not.toContain("confidential");
    expect(userPrompt).not.toContain("secret road");
    expect(userPrompt).not.toContain("note should never");
    expect(userPrompt).not.toContain(USER_EMAIL);
    expect(userPrompt).not.toContain("tx-");
    expect(userPrompt).not.toContain("savings_move");
    expect(userPrompt).toContain("₹5,800");
    expect(userPrompt).toContain("Groceries");
  });
});

describe("POST /api/v1/ai/insights", () => {
  function makeRouteClient(opts: MockQueryOptions = {}) {
    const client = makeClient(opts);
    (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(client);
    return client;
  }

  function makeRequest(overrides: Partial<RequestInit> = {}): Request {
    return new Request("http://localhost/api/v1/ai/insights", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${USER_ID}`,
        "x-forwarded-for": "198.51.100.20",
        ...(overrides.headers as Record<string, string>),
      },
      ...overrides,
    });
  }

  it("rejects a missing token with 401", async () => {
    makeRouteClient();
    const res = await aiInsightsPOST(
      new Request("http://localhost/api/v1/ai/insights", { method: "POST" })
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("unauthorized");
  });

  it("rejects an invalid session with 401", async () => {
    makeRouteClient({ getUserError: { message: "token expired" } });
    const res = await aiInsightsPOST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns AI insights on success (HTTP 200)", async () => {
    fetchMock.mockResolvedValue(openAIResponse("August overview for you."));
    makeRouteClient();
    const res = await aiInsightsPOST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.insights).toBe("August overview for you.");
    expect(body.model).toBe("gpt-4o-mini");
  });

  it("returns a graceful unavailable response when AI is disabled", async () => {
    setEnv({ AI_ENABLED: "false" });
    fetchMock.mockResolvedValue(openAIResponse("should not be called"));
    makeRouteClient();
    const res = await aiInsightsPOST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body.code).toBe("not_configured");
  });

  it("returns a friendly fallback when the provider errors", async () => {
    fetchMock.mockResolvedValue(fetchResponse(401, { error: { message: "Invalid API key" } }));
    makeRouteClient();
    const res = await aiInsightsPOST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body.message).toContain("administrator");
    expect(body.message).not.toContain("Invalid API key");
  });

  it("falls back when Ollama is unreachable", async () => {
    setEnv({ AI_PROVIDER: "ollama", OLLAMA_ENABLED: "true" });
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    makeRouteClient();
    const res = await aiInsightsPOST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body.code).toBe("network");
  });

  it("rate-limits after 12 requests from one user (429)", async () => {
    fetchMock.mockResolvedValue(openAIResponse("x"));
    const RATE_USER_ID = "00000000-0000-4000-8000-0000000000aa";
    const client = makeClient({
      user: { id: RATE_USER_ID, email: "rate@example.com" },
      tables: {
        profiles: [{ id: RATE_USER_ID, email: "rate@example.com", monthly_budget: 10000 }],
        transactions: sampleTxns(),
      },
    });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const makeRateReq = () =>
      new Request("http://localhost/api/v1/ai/insights", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RATE_USER_ID}`,
          "x-forwarded-for": "203.0.113.77",
        },
        body: JSON.stringify({}),
      });
    for (let i = 0; i < 12; i++) {
      expect((await aiInsightsPOST(makeRateReq())).status).toBe(200);
    }
    const blocked = await aiInsightsPOST(makeRateReq());
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.code).toBe("rate_limited");
  });
});
