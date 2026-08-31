import { supabase } from "@/lib/supabaseClient";
import {
  type BugReport,
  type BugReportCategory,
  type BugReportSeverity,
  isBugReportCategory,
  isBugReportSeverity,
} from "@/lib/bugReports";

export type SubmitBugReportInput = {
  title: string;
  description: string;
  category: BugReportCategory | null;
  severity: BugReportSeverity | null;
  stepsToReproduce?: string | null;
  expectedBehavior?: string | null;
  actualBehavior?: string | null;
};

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 4000;

class BugReportSubmitError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Submit a bug report through the SECURITY DEFINER RPC. The server is the
 * authority: user_id is pinned to the caller and status is forced to 'open',
 * so response errors are mapped to human-readable messages.
 */
export async function submitBugReport(input: SubmitBugReportInput): Promise<{ id: string }> {
  const title = input.title.trim();
  const description = input.description.trim();

  if (!title) throw new BugReportSubmitError("Please describe the problem briefly.", "invalid_report");
  if (!description) throw new BugReportSubmitError("Please add a few details about what happened.", "invalid_report");
  if (title.length > MAX_TITLE) {
    throw new BugReportSubmitError(`Title must be ${MAX_TITLE} characters or fewer.`, "invalid_report");
  }
  if (description.length > MAX_DESCRIPTION) {
    throw new BugReportSubmitError(`Description must be ${MAX_DESCRIPTION} characters or fewer.`, "invalid_report");
  }

  let category: string | null = input.category ?? null;
  if (category !== null && !isBugReportCategory(category)) category = "other";
  let severity: string | null = input.severity ?? null;
  if (severity !== null && !isBugReportSeverity(severity)) severity = null;

  const pageUrl =
    typeof window !== "undefined" && typeof window.location?.href === "string"
      ? window.location.href.slice(0, 2000)
      : null;
  const userAgent =
    typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
      ? navigator.userAgent.slice(0, 300)
      : null;

  const { data, error } = await supabase.rpc("submit_bug_report", {
    p_title: title,
    p_description: description,
    p_category: category,
    p_severity: severity,
    p_steps_to_reproduce: input.stepsToReproduce?.trim().slice(0, 2000) || null,
    p_expected_behavior: input.expectedBehavior?.trim().slice(0, 2000) || null,
    p_actual_behavior: input.actualBehavior?.trim().slice(0, 2000) || null,
    p_page_url: pageUrl,
    p_user_agent: userAgent,
  });

  if (error) {
    if (error.message === "invalid_report") {
      throw new BugReportSubmitError("Please add a title and a description before submitting.", "invalid_report");
    }
    if (error.message === "invalid_category") {
      throw new BugReportSubmitError("That category isn't supported. Choose another one.", "invalid_category");
    }
    if (error.message === "invalid_severity") {
      throw new BugReportSubmitError("That severity isn't supported. Choose another one.", "invalid_severity");
    }
    throw new BugReportSubmitError("Couldn't submit the report right now. Please try again.", "submit_error");
  }

  return { id: String(data) };
}

/** The signed-in user's own reports, newest first (RLS-scoped to their rows). */
export async function getMyBugReports(userId: string): Promise<BugReport[]> {
  const { data, error } = await supabase
    .from("bug_reports")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error("Could not load your reports. Please try again.");
  return (data ?? []) as BugReport[];
}