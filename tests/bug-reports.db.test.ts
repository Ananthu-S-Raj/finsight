import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression contract tests for the "Report a Bug" migration.
 *
 * These tests read the actual SQL and lock the security model the feature
 * depends on:
 *   1. bug_reports exists with the agreed columns, defaults and CHECK
 *      constraints (status/category/severity vocabulary, length caps).
 *   2. RLS is enabled; users can SELECT only their own rows; admins read all
 *      and update via has_permission('BUG_REPORT_MANAGE'); there is NO user
 *      INSERT/UPDATE/DELETE policy and NO anon access.
 *   3. submit_bug_report is the ONLY creation path — SECURITY DEFINER, pins
 *      user_id = auth.uid(), sets status = 'open', and is revoked from the
 *      anonymous role.
 *   4. BUG_REPORT_MANAGE is seeded and granted to the admin role.
 */
const MIGRATION = join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260911000000_bug_reports.sql"
);

function readSql(): string {
  return readFileSync(MIGRATION, "utf8");
}

function functionBlock(sql: string, fnPrefix: string): string {
  const marker = `create or replace function public.${fnPrefix}`;
  const start = sql.indexOf(marker);
  if (start === -1) return "";
  const next = sql.indexOf("create or replace function public.", start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

describe("bug_reports migration (contract)", () => {
  const sql = readSql();

  describe("table definition", () => {
    const table = sql.slice(sql.indexOf("create table if not exists public.bug_reports"), sql.indexOf("-- 2. Indexes"));

    it("defines every agreed column with the right types and defaults", () => {
      expect(table).toMatch(/id uuid primary key default gen_random_uuid\(\)/);
      expect(table).toMatch(/user_id uuid not null references auth\.users\(id\) on delete cascade/);
      expect(table).toMatch(/title text not null/);
      expect(table).toMatch(/description text not null/);
      expect(table).toMatch(/category text/);
      expect(table).toMatch(/severity text/);
      for (const col of [
        "steps_to_reproduce text",
        "expected_behavior text",
        "actual_behavior text",
        "page_url text",
        "user_agent text",
        "admin_notes text",
      ]) {
        expect(table).toContain(col);
      }
      expect(table).toMatch(/status text not null default 'open'/);
      expect(table).toMatch(/created_at timestamptz not null default now\(\)/);
      expect(table).toMatch(/updated_at timestamptz not null default now\(\)/);
    });

    it("enforces the status vocabulary", () => {
      expect(table).toMatch(/constraint bug_reports_status_ck check \(\s*status in \('open', 'in_progress', 'resolved', 'closed'\)\s*\)/);
    });

    it("enforces the category and severity vocabularies (nullable-allowed)", () => {
      expect(table).toMatch(/constraint bug_reports_category_ck check \(\s*category is null or category in \('bug', 'performance', 'privacy', 'usability', 'billing', 'other'\)\s*\)/);
      expect(table).toMatch(/constraint bug_reports_severity_ck check \(\s*severity is null or severity in \('low', 'medium', 'high', 'critical'\)\s*\)/);
    });

    it("caps field lengths", () => {
      expect(table).toMatch(/bug_reports_title_len check \(char_length\(title\) between 1 and 120\)/);
      expect(table).toMatch(/bug_reports_description_len check \(char_length\(description\) between 1 and 4000\)/);
      expect(table).toMatch(/bug_reports_steps_len check \(char_length\(steps_to_reproduce\) <= 2000\)/);
      expect(table).toMatch(/bug_reports_expected_len check \(char_length\(expected_behavior\) <= 2000\)/);
      expect(table).toMatch(/bug_reports_actual_len check \(char_length\(actual_behavior\) <= 2000\)/);
      expect(table).toMatch(/bug_reports_page_url_len check \(char_length\(page_url\) <= 2000\)/);
      expect(table).toMatch(/bug_reports_user_agent_len check \(char_length\(user_agent\) <= 300\)/);
      expect(table).toMatch(/bug_reports_admin_notes_len check \(char_length\(admin_notes\) <= 4000\)/);
    });
  });

  describe("indexes", () => {
    it("indexes the admin triage axes", () => {
      expect(sql).toContain("create index if not exists bug_reports_user_id_idx on public.bug_reports (user_id);");
      expect(sql).toContain("create index if not exists bug_reports_status_idx on public.bug_reports (status);");
      expect(sql).toContain("create index if not exists bug_reports_created_at_idx on public.bug_reports (created_at desc);");
    });
  });

  describe("row level security", () => {
    it("enables RLS on the table", () => {
      expect(sql).toContain("alter table public.bug_reports enable row level security;");
    });

    it("lets users SELECT only their own rows", () => {
      expect(sql).toMatch(/create policy "bug_reports: user read own" on public\.bug_reports\s+for select using \(auth\.uid\(\) = user_id\);/);
    });

    it("lets admins read all and update via BUG_REPORT_MANAGE", () => {
      expect(sql).toMatch(/create policy "bug_reports: admin read all" on public\.bug_reports\s+for select using \(public\.has_permission\('BUG_REPORT_MANAGE'\)\);/);
      expect(sql).toMatch(/create policy "bug_reports: admin update" on public\.bug_reports\s+for update using \(public\.has_permission\('BUG_REPORT_MANAGE'\)\)\s+with check \(public\.has_permission\('BUG_REPORT_MANAGE'\)\);/);
    });

    it("creates NO user insert/update/delete policy (users cannot write directly)", () => {
      expect(sql).not.toMatch(/create policy "bug_reports: user insert"/i);
      expect(sql).not.toMatch(/create policy "bug_reports: user update"/i);
      expect(sql).not.toMatch(/create policy "bug_reports: user delete"/i);
      expect(sql).not.toMatch(/for insert with check \(auth\.uid\(\) = user_id\)/);
    });

    it("creates NO delete policy for anyone (reports are permanent)", () => {
      expect(sql).not.toMatch(/for delete using/);
    });
  });

  describe("submit_bug_report RPC", () => {
    const block = functionBlock(sql, "submit_bug_report(");

    it("is SECURITY DEFINER with a pinned search_path", () => {
      expect(block).toMatch(/language plpgsql security definer set search_path = public/);
    });

    it("demands a title and description and refuses the rest as 'invalid_report'", () => {
      expect(block).toMatch(/char_length\(v_title\) = 0 or char_length\(v_description\) = 0/);
      expect(block).toMatch(/raise exception 'invalid_report'/);
    });

    it("validates category and severity against the CHECK vocabulary", () => {
      expect(block).toMatch(/raise exception 'invalid_category'/);
      expect(block).toMatch(/raise exception 'invalid_severity'/);
    });

    it("pins user_id = auth.uid() and status = 'open' so clients can't forge them", () => {
      expect(block).toMatch(/auth\.uid\(\),/);
      expect(block).toMatch(/'open'/);
      expect(block).not.toMatch(/p_user_id/);
      expect(block).not.toMatch(/p_status/);
    });

    it("returns the new row id", () => {
      expect(block).toMatch(/returns uuid/);
      expect(block).toMatch(/returning id into v_id/);
      expect(block).toMatch(/return v_id;/);
    });
  });

  describe("privileges", () => {
    it("revokes the RPC from the anonymous role and grants only app roles", () => {
      expect(sql).toMatch(/revoke all on function public\.submit_bug_report\(\n?\s*text, text, text, text, text, text, text, text, text\n?\) from public;/);
      expect(sql).toMatch(/grant execute on function public\.submit_bug_report\(\n?\s*text, text, text, text, text, text, text, text, text\n?\) to authenticated, service_role;/);
      expect(sql).not.toMatch(/submit_bug_report[\s\S]*?to anon/);
    });
  });

  describe("BUG_REPORT_MANAGE permission", () => {
    it("seeds the permission code with the required name column", () => {
      // permissions.name is NOT NULL in production, so the seed must supply it
      // — the original two-column seed crashed production and was the reason
      // this migration had to be corrected.
      expect(sql).toMatch(
        /insert into public\.permissions \(name, code, description\)[\s\S]*\('BUG_REPORT_MANAGE', 'BUG_REPORT_MANAGE', 'View and manage bug reports'\)[\s\S]*on conflict \(code\) do nothing;/
      );
    });

    it("grants it to the admin role via the established cross-join", () => {
      expect(sql).toMatch(/where r\.name = 'admin'\s+and p\.code = 'BUG_REPORT_MANAGE'/);
      expect(sql).toMatch(/on conflict do nothing;/);
    });
  });
});