import { describe, it, expect, vi, beforeEach } from "vitest";
import { submitBugReport, getMyBugReports } from "@/lib/bugReportsApi";
import { USER_A_ID } from "./helpers/fixtures";

// The module under test imports { supabase } from the singleton. Keep a stable
// object and swap its methods per test so mocked clients are injected live.
const supabaseHolder = vi.hoisted(() => ({ supabase: {} as any }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: supabaseHolder.supabase }));

type RpcRecord = { name: string; args: Record<string, unknown> };

/**
 * A minimal fake client tailored to bugReportsApi so RPC arguments can be
 * asserted exactly. (The shared MockClient does not record rpc calls.)
 */
function fakeRpc(record: RpcRecord[], outcome: { data: unknown; error: unknown }) {
  return (name: string, args: unknown) => {
    record.push({ name, args: args as Record<string, unknown> });
    return Promise.resolve(outcome);
  };
}

function fakeFrom(rows: Record<string, unknown>[] | null, captured?: Array<{ table: string; eqCol: string; eqVal: unknown; asc: boolean }>, fail = false) {
  return (table: string) => {
    const state = { table, eqCol: "", eqVal: null as unknown, asc: false };
    return {
      select: () => ({
        eq: (col: string, val: unknown) => {
          state.eqCol = col;
          state.eqVal = val;
          return {
            order: (_col: string, opts: { ascending: boolean }) => {
              state.asc = opts.ascending;
              captured?.push({ ...state });
              return Promise.resolve(
                fail
                  ? { data: null, count: null, error: { message: "db down", code: "PGRST500" } }
                  : { data: rows ?? [], count: (rows ?? []).length, error: null }
              );
            },
          };
        },
      }),
    } as never;
  };
}

beforeEach(() => {
  supabaseHolder.supabase.rpc = undefined;
  supabaseHolder.supabase.from = undefined;
});

describe("submitBugReport", () => {
  it("calls submit_bug_report with the trimmed payload and returns the id", async () => {
    vi.stubGlobal("window", { location: { href: "https://app.finsight.io/overview" } });
    vi.stubGlobal("navigator", { userAgent: "FinSightTest/1.0" });
    const record: RpcRecord[] = [];
    supabaseHolder.supabase.rpc = fakeRpc(record, { data: "report-1", error: null });

    try {
      const result = await submitBugReport({
        title: "  Dashboard freezes  ",
        description: "  Crashes on load.  ",
        category: "bug",
        severity: "high",
        stepsToReproduce: "Open dashboard",
        expectedBehavior: "Loads fine",
        actualBehavior: "Freezes",
      });

      expect(result).toEqual({ id: "report-1" });
      expect(record).toHaveLength(1);
      expect(record[0].name).toBe("submit_bug_report");
      expect(record[0].args).toMatchObject({
        p_title: "Dashboard freezes",
        p_description: "Crashes on load.",
        p_category: "bug",
        p_severity: "high",
        p_steps_to_reproduce: "Open dashboard",
        p_expected_behavior: "Loads fine",
        p_actual_behavior: "Freezes",
        p_page_url: "https://app.finsight.io/overview",
        p_user_agent: "FinSightTest/1.0",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails fast (without RPC) when required fields are blank", async () => {
    let called = false;
    supabaseHolder.supabase.rpc = () => {
      called = true;
      return Promise.resolve({ data: null, error: null });
    };

    await expect(
      submitBugReport({ title: "   ", description: "", category: null, severity: null })
    ).rejects.toThrow("Please describe the problem briefly.");
    expect(called).toBe(false);
  });

  it("rejects overlong titles and long descriptions client-side", async () => {
    let called = false;
    supabaseHolder.supabase.rpc = () => {
      called = true;
      return Promise.resolve({ data: "x", error: null });
    };

    await expect(
      submitBugReport({
        title: "x".repeat(121),
        description: "ok",
        category: null,
        severity: null,
      })
    ).rejects.toThrow("Title must be 120 characters or fewer.");
    await expect(
      submitBugReport({
        title: "ok",
        description: "x".repeat(4001),
        category: null,
        severity: null,
      })
    ).rejects.toThrow("Description must be 4000 characters or fewer.");
    expect(called).toBe(false);
  });

  it("maps the server-side invalid_report error to a friendly message", async () => {
    supabaseHolder.supabase.rpc = () =>
      Promise.resolve({ data: null, error: { message: "invalid_report", code: "PGRST203" } });

    await expect(
      submitBugReport({ title: "title", description: "desc", category: null, severity: null })
    ).rejects.toThrow("Please add a title and a description before submitting.");
  });

  it("normalises an unknown category to 'other' and an unknown severity to null", async () => {
    const record: RpcRecord[] = [];
    supabaseHolder.supabase.rpc = fakeRpc(record, { data: "report-2", error: null });

    await submitBugReport({
      title: "t",
      description: "d",
      // @ts-expect-error deliberately invalid so the normalisation is exercised
      category: "nonsense",
      // @ts-expect-error deliberately invalid
      severity: "urgent",
    });

    expect(record[0].args.p_category).toBe("other");
    expect(record[0].args.p_severity).toBeNull();
  });

  it("swallows unexpected RPC errors into a single safe message", async () => {
    supabaseHolder.supabase.rpc = () =>
      Promise.resolve({ data: null, error: { message: "network: boom", code: "PGRST301" } });

    await expect(
      submitBugReport({ title: "t", description: "d", category: null, severity: null })
    ).rejects.toThrow("Couldn't submit the report right now. Please try again.");
  });
});

describe("getMyBugReports", () => {
  const row = {
    id: "report-1",
    user_id: USER_A_ID,
    title: "Slow",
    description: "Very slow",
    category: "performance",
    severity: "medium",
    steps_to_reproduce: null,
    expected_behavior: null,
    actual_behavior: null,
    page_url: null,
    user_agent: null,
    status: "open",
    admin_notes: null,
    created_at: "2026-09-01T08:00:00Z",
    updated_at: "2026-09-01T08:00:00Z",
  };

  it("queries only the caller's rows, newest first", async () => {
    const captured: Array<{ table: string; eqCol: string; eqVal: unknown; asc: boolean }> = [];
    supabaseHolder.supabase.from = fakeFrom([row], captured);

    const result = await getMyBugReports(USER_A_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "report-1", status: "open", category: "performance" });
    expect(captured).toHaveLength(1);
    expect(captured[0].table).toBe("bug_reports");
    expect(captured[0].eqCol).toBe("user_id");
    expect(captured[0].eqVal).toBe(USER_A_ID);
    expect(captured[0].asc).toBe(false);
  });

  it("returns an empty list when there are no reports", async () => {
    supabaseHolder.supabase.from = fakeFrom([]);
    const result = await getMyBugReports(USER_A_ID);
    expect(result).toEqual([]);
  });

  it("throws a friendly error when the read fails", async () => {
    supabaseHolder.supabase.from = fakeFrom(null, undefined, true);
    await expect(getMyBugReports(USER_A_ID)).rejects.toThrow(
      "Could not load your reports. Please try again."
    );
  });
});