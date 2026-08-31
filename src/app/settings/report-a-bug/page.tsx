"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/ui/GlassCard";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icons";
import { useToast } from "@/components/ui/ToastProvider";
import { useRequireAuth } from "@/lib/useAuth";
import { getProfile, type Profile } from "@/lib/finance";
import {
  BUG_REPORT_CATEGORIES,
  BUG_REPORT_CATEGORY_LABELS,
  BUG_REPORT_SEVERITIES,
  BUG_REPORT_STATUS_LABELS,
  type BugReport,
  type BugReportCategory,
  type BugReportSeverity,
} from "@/lib/bugReports";
import { getMyBugReports, submitBugReport } from "@/lib/bugReportsApi";
import { haptic } from "@/lib/haptics";
import { timeAgo } from "@/lib/format";

const STATUS_COLORS: Record<BugReport["status"], string> = {
  open: "#6366f1",
  in_progress: "#f59e0b",
  resolved: "#10b981",
  closed: "#94a3b8",
};

const SEVERITY_COLORS: Record<BugReportSeverity, string> = {
  low: "#94a3b8",
  medium: "#f59e0b",
  high: "#fb923c",
  critical: "#ef4444",
};

const EMPTY_FORM = {
  title: "",
  description: "",
  category: "" as BugReportCategory | "",
  severity: "" as BugReportSeverity | "",
  steps: "",
  expected: "",
  actual: "",
};

export default function ReportABugPage() {
  const userId = useRequireAuth();
  const toast = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);

  const [reports, setReports] = useState<BugReport[] | null>(null);
  const [listError, setListError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    document.title = "Report a Bug · FinSight";
  }, []);

  useEffect(() => {
    if (!userId) return;
    getProfile(userId).then(setProfile).catch(() => setProfile(null));
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function loadReports() {
    if (!userId) return;
    setListError("");
    try {
      setReports(await getMyBugReports(userId));
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Couldn't load your reports.");
    }
  }

  function setField<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSubmitError("");
    setJustSubmitted(false);
  }

  async function onSubmit() {
    if (submitting) return;
    setSubmitError("");
    setJustSubmitted(false);

    if (!form.title.trim() || !form.description.trim()) {
      setSubmitError("A title and a description are required.");
      return;
    }

    setSubmitting(true);
    try {
      await submitBugReport({
        title: form.title,
        description: form.description,
        category: form.category || null,
        severity: form.severity || null,
        stepsToReproduce: form.steps || null,
        expectedBehavior: form.expected || null,
        actualBehavior: form.actual || null,
      });
      haptic("success");
      setForm(EMPTY_FORM);
      setJustSubmitted(true);
      toast.success("Bug report submitted. Thanks for helping!");
      await loadReports();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Couldn't submit the report right now.");
    } finally {
      setSubmitting(false);
    }
  }

  const pageUrl =
    typeof window !== "undefined" && typeof window.location?.href === "string"
      ? window.location.href
      : null;
  const browser = typeof navigator !== "undefined" && typeof navigator.userAgent === "string" ? navigator.userAgent : null;

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <AppShell
      userId={userId ?? ""}
      profile={profile ? { full_name: profile.full_name, email: profile.email, role: profile.role } : null}
    >
      <PageHeader title="Report a Bug" subtitle="Tell us what went wrong. Details go straight to our team." icon="alert" />

      <div className="space-y-4 animate-fade-up">
        {justSubmitted && (
          <div className="glass rounded-2xl p-4 flex items-start gap-3 animate-fade-up">
            <span className="h-9 w-9 rounded-xl inline-flex items-center justify-center shrink-0" style={{ background: "#10b9811a", color: "#10b981" }}>
              <Icon name="check" size={18} />
            </span>
            <div>
              <p className="text-sm font-semibold text-snow">Report submitted.</p>
              <p className="text-[13px] text-slate mt-0.5">Our team will take a look. You can track its status below.</p>
            </div>
          </div>
        )}

        <GlassCard>
          <div className="px-5 pt-4 pb-1 flex items-center gap-2">
            <Icon name="alert" size={15} className="text-accent" />
            <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate">What happened?</h2>
          </div>
          <div className="px-5 py-4 space-y-4">
            {submitError && (
              <p className="text-sm flex items-start gap-2 text-danger">
                <Icon name="alert" size={15} className="mt-0.5 shrink-0" /> {submitError}
              </p>
            )}
            <label className="block">
              <span className="block text-sm text-slate mb-1">Title</span>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setField("title", e.target.value)}
                className="field"
                placeholder="Short summary of the problem"
                maxLength={120}
                aria-label="Title"
              />
            </label>
            <label className="block">
              <span className="block text-sm text-slate mb-1">Description</span>
              <textarea
                value={form.description}
                onChange={(e) => setField("description", e.target.value)}
                className="field min-h-[120px]"
                placeholder="What did you expect, and what actually happened?"
                maxLength={4000}
                aria-label="Description"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="block text-sm text-slate mb-1">Category</span>
                <select value={form.category} onChange={(e) => setField("category", e.target.value as BugReportCategory | "")} className="field" aria-label="Category">
                  <option value="">General</option>
                  {BUG_REPORT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {BUG_REPORT_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-sm text-slate mb-1">Severity</span>
                <select value={form.severity} onChange={(e) => setField("severity", e.target.value as BugReportSeverity | "")} className="field" aria-label="Severity">
                  <option value="">Not sure</option>
                  {BUG_REPORT_SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="block text-sm text-slate mb-1">Steps to reproduce</span>
              <textarea
                value={form.steps}
                onChange={(e) => setField("steps", e.target.value)}
                className="field min-h-[72px]"
                placeholder="Optional — what did you do to trigger it?"
                maxLength={2000}
                aria-label="Steps to reproduce"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="block text-sm text-slate mb-1">Expected behavior</span>
                <textarea
                  value={form.expected}
                  onChange={(e) => setField("expected", e.target.value)}
                  className="field min-h-[72px]"
                  placeholder="Optional"
                  maxLength={2000}
                  aria-label="Expected behavior"
                />
              </label>
              <label className="block">
                <span className="block text-sm text-slate mb-1">Actual behavior</span>
                <textarea
                  value={form.actual}
                  onChange={(e) => setField("actual", e.target.value)}
                  className="field min-h-[72px]"
                  placeholder="Optional"
                  maxLength={2000}
                  aria-label="Actual behavior"
                />
              </label>
            </div>
            <p className="text-[12px] leading-relaxed text-muted">
              We&apos;ll include the page you were on ({pageUrl ? "this page" : "unknown"}) and your browser
              ({browser ? "detected automatically" : "unknown"}) to help reproduce the issue.
            </p>
            <Button variant="primary" full onClick={onSubmit} disabled={submitting} icon={submitting ? undefined : "alert"}>
              {submitting ? "Submitting…" : "Submit bug report"}
            </Button>
          </div>
        </GlassCard>

        <GlassCard>
          <div className="px-5 pt-4 pb-1 flex items-center gap-2">
            <Icon name="profile" size={15} className="text-accent" />
            <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate">My Bug Reports</h2>
          </div>
          <div className="border-t border-line divide-y divide-line">
            {listError && (
              <div className="px-5 py-4">
                <p className="text-sm text-danger mb-3">{listError}</p>
                <Button variant="ghost" onClick={loadReports}>Retry</Button>
              </div>
            )}
            {!listError && reports === null && (
              <p className="px-5 py-5 text-sm text-slate">Loading your reports…</p>
            )}
            {!listError && reports !== null && reports.length === 0 && (
              <p className="px-5 py-5 text-sm text-slate">
                {justSubmitted ? "Your report appears below." : "You haven't reported anything yet."}
              </p>
            )}
            {!listError &&
              reports !== null &&
              reports.map((r) => {
                const open = expanded.has(r.id);
                const statusColor = STATUS_COLORS[r.status];
                return (
                  <div key={r.id}>
                    <button type="button" onClick={() => toggleExpand(r.id)} className="w-full px-5 py-4 text-left hover:bg-tint/50 transition-colors">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-snow flex-1 min-w-0">{r.title}</p>
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold capitalize"
                          style={{ background: `${statusColor}1a`, color: statusColor, boxShadow: `inset 0 0 0 1px ${statusColor}33` }}
                        >
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />
                          {BUG_REPORT_STATUS_LABELS[r.status]}
                        </span>
                        <Icon name="chevronRight" size={15} className={`text-slate transition-transform ${open ? "rotate-90" : ""}`} />
                      </div>
                      <div className="flex items-center gap-2 flex-wrap mt-1.5">
                        <span className="text-[12px] text-slate">{timeAgo(r.created_at)}</span>
                        {r.category && <span className="text-[12px] text-slate">· {BUG_REPORT_CATEGORY_LABELS[r.category]}</span>}
                        {r.severity && (
                          <span className="text-[12px] font-semibold capitalize" style={{ color: SEVERITY_COLORS[r.severity] }}>
                            · {r.severity}
                          </span>
                        )}
                      </div>
                    </button>
                    {open && (
                      <div className="px-5 pb-4 -mt-1 space-y-3 text-sm">
                        <p className="text-snow leading-relaxed whitespace-pre-wrap">{r.description}</p>
                        {r.steps_to_reproduce && (
                          <p className="text-slate leading-relaxed">
                            <span className="font-semibold text-snow">Steps: </span>
                            <span className="whitespace-pre-wrap">{r.steps_to_reproduce}</span>
                          </p>
                        )}
                        {r.expected_behavior && (
                          <p className="text-slate leading-relaxed">
                            <span className="font-semibold text-snow">Expected: </span>
                            <span className="whitespace-pre-wrap">{r.expected_behavior}</span>
                          </p>
                        )}
                        {r.actual_behavior && (
                          <p className="text-slate leading-relaxed">
                            <span className="font-semibold text-snow">Actual: </span>
                            <span className="whitespace-pre-wrap">{r.actual_behavior}</span>
                          </p>
                        )}
                        {r.page_url && <p className="text-[13px] text-muted break-all">Page: {r.page_url}</p>}
                        {r.user_agent && <p className="text-[12px] text-muted break-all">Browser: {r.user_agent}</p>}
                        {r.admin_notes && (
                          <p className="text-[13px] rounded-xl px-3 py-2 border border-line bg-tint-hi text-slate">
                            <span className="font-semibold text-snow">Update from our team:</span>{" "}
                            <span className="whitespace-pre-wrap">{r.admin_notes}</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </GlassCard>
      </div>
    </AppShell>
  );
}