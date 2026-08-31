/**
 * Bug report vocabulary shared by the user-facing report form, the Admin
 * Console, and the API handlers. Intentionally dependency-free: it must be
 * safe to import from client components, server handlers, and tests alike
 * (same convention as src/lib/admin/auditResourceTypes.ts).
 *
 * These values mirror the CHECK constraints seeded in
 * supabase/migrations/20260911000000_bug_reports.sql so UI and database can
 * never drift.
 */

export const BUG_REPORT_CATEGORIES = [
  "bug",
  "performance",
  "privacy",
  "usability",
  "billing",
  "other",
] as const;

export type BugReportCategory = (typeof BUG_REPORT_CATEGORIES)[number];

export const BUG_REPORT_CATEGORY_LABELS: Record<BugReportCategory, string> = {
  bug: "Bug",
  performance: "Performance",
  privacy: "Privacy",
  usability: "Usability",
  billing: "Billing",
  other: "Other",
};

export const BUG_REPORT_SEVERITIES = ["low", "medium", "high", "critical"] as const;

export type BugReportSeverity = (typeof BUG_REPORT_SEVERITIES)[number];

export const BUG_REPORT_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

export type BugReportStatus = (typeof BUG_REPORT_STATUSES)[number];

export type BugReport = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: BugReportCategory | null;
  severity: BugReportSeverity | null;
  steps_to_reproduce: string | null;
  expected_behavior: string | null;
  actual_behavior: string | null;
  page_url: string | null;
  user_agent: string | null;
  status: BugReportStatus;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
};

export const BUG_REPORT_STATUS_LABELS: Record<BugReportStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

/** True when a user-supplied value is one of the supported categories. */
export function isBugReportCategory(value: string): value is BugReportCategory {
  return (BUG_REPORT_CATEGORIES as readonly string[]).includes(value);
}

/** True when a user-supplied value is one of the supported severities. */
export function isBugReportSeverity(value: string): value is BugReportSeverity {
  return (BUG_REPORT_SEVERITIES as readonly string[]).includes(value);
}

/** True when a user-supplied value is one of the supported statuses. */
export function isBugReportStatus(value: string): value is BugReportStatus {
  return (BUG_REPORT_STATUSES as readonly string[]).includes(value);
}