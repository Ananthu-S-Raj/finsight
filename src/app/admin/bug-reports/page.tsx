"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AdminPage from "@/components/admin/AdminPage";
import {
  EmptyState,
  LoadingRow,
  Pagination,
  SearchInput,
  SectionCard,
  StatusBadge,
} from "@/components/admin/ui";
import Button from "@/components/ui/Button";
import GlassCard from "@/components/ui/GlassCard";
import Icon from "@/components/ui/Icons";
import { useToast } from "@/components/ui/ToastProvider";
import { adminFetch, type AdminBugReport, type Paged } from "@/lib/admin/client";
import { useAdminData } from "@/lib/admin/useAdminData";
import {
  BUG_REPORT_CATEGORIES,
  BUG_REPORT_CATEGORY_LABELS,
  type BugReportSeverity,
  type BugReportStatus,
} from "@/lib/bugReports";
import { timeAgo } from "@/lib/format";

type Filter = { search: string; status: string; category: string; page: number };

const SEVERITY_COLORS: Record<BugReportSeverity, string> = {
  low: "#94a3b8",
  medium: "#f59e0b",
  high: "#fb923c",
  critical: "#ef4444",
};

function SeverityPill({ severity }: { severity: BugReportSeverity | null }) {
  if (!severity) return <span className="text-[13px] text-muted">—</span>;
  const color = SEVERITY_COLORS[severity];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-semibold capitalize"
      style={{ background: `${color}1a`, color, boxShadow: `inset 0 0 0 1px ${color}33` }}
    >
      {severity}
    </span>
  );
}

export default function AdminBugReportsPage() {
  // useSearchParams needs a Suspense boundary during prerendering.
  return (
    <Suspense fallback={null}>
      <AdminBugReportsPageInner />
    </Suspense>
  );
}

function AdminBugReportsPageInner() {
  useEffect(() => {
    document.title = "Bug Reports · Admin · FinSight";
  }, []);
  const toast = useToast();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<Filter>(() => ({
    search: "",
    status: "",
    category: "",
    page: 1,
  }));
  const [pending, setPending] = useState<AdminBugReport | null>(null);
  const [busy, setBusy] = useState(false);

  const params = new URLSearchParams();
  if (filter.search) params.set("search", filter.search);
  if (filter.status) params.set("status", filter.status);
  if (filter.category) params.set("category", filter.category);
  params.set("page", String(filter.page));
  params.set("pageSize", "15");

  const state = useAdminData<Paged<AdminBugReport>>(`/bug-reports?${params.toString()}`);
  const apply = useCallback((patch: Partial<Filter>) => setFilter((f) => ({ ...f, ...patch, page: 1 })), []);
  const hasFilters = Boolean(filter.search.trim() || filter.status || filter.category);
  const reset = useCallback(() => setFilter({ search: "", status: "", category: "", page: 1 }), []);

  async function save(patch: { status: BugReportStatus; admin_notes: string }) {
    if (!pending) return;
    setBusy(true);
    try {
      await adminFetch(`/bug-reports/${pending.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      toast.success("Bug report updated.");
      setPending(null);
      state.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage title="Bug Reports" subtitle="Triaged user-submitted issues" icon="alert">
      <SectionCard title="Filters">
        <div className="p-5 flex flex-col sm:flex-row gap-2">
          <SearchInput
            value={filter.search}
            onChange={(v) => apply({ search: v })}
            placeholder="Search title or description…"
            className="flex-1"
          />
          <select value={filter.status} onChange={(e) => apply({ status: e.target.value })} className="field sm:w-44" aria-label="Status filter">
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          <select value={filter.category} onChange={(e) => apply({ category: e.target.value })} className="field sm:w-40" aria-label="Category filter">
            <option value="">All categories</option>
            {BUG_REPORT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {BUG_REPORT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        {hasFilters && (
          <div className="px-5 pb-4 -mt-1">
            <button type="button" onClick={reset} className="btn btn-ghost btn-sm text-[13px]">
              Reset filters
            </button>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Reports" className="mt-4">
        {state.status === "error" && (
          <div className="p-5">
            <EmptyState icon="alert" title="Could not load bug reports" hint={state.error.message} />
          </div>
        )}
        {state.status === "loading" && <LoadingRow />}
        {state.status === "ready" && (
          <>
            <div className="overflow-x-auto scroll-slim">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-left text-[13px] uppercase tracking-widest text-slate border-b border-line">
                    <th className="px-5 py-3 font-semibold">Reporter</th>
                    <th className="px-4 py-3 font-semibold">Issue</th>
                    <th className="px-4 py-3 font-semibold">Category</th>
                    <th className="px-4 py-3 font-semibold">Severity</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Submitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {state.data.items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-6">
                        <EmptyState icon="alert" title="No bug reports match" />
                      </td>
                    </tr>
                  )}
                  {state.data.items.map((r) => (
                    <tr key={r.id} className="hover:bg-tint transition-colors">
                      <td className="px-5 py-3">
                        <button type="button" onClick={() => setPending(r)} className="text-left group">
                          <p className="font-semibold text-snow truncate max-w-[160px] group-hover:underline">
                            {r.user?.full_name || "Unknown user"}
                          </p>
                          <p className="text-[13px] text-slate truncate max-w-[160px]">{r.user?.email ?? r.user_id.slice(0, 8)}</p>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => setPending(r)} className="text-left group">
                          <p className="font-semibold text-snow truncate max-w-[220px] group-hover:underline">{r.title}</p>
                          <p className="text-[13px] text-slate truncate max-w-[220px]">{r.description}</p>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {r.category ? (
                          <span className="text-[13px] text-snow">{BUG_REPORT_CATEGORY_LABELS[r.category]}</span>
                        ) : (
                          <span className="text-[13px] text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <SeverityPill severity={r.severity} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge value={r.status} />
                      </td>
                      <td className="px-4 py-3 text-[13px] text-slate">{timeAgo(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={state.data.page} pages={state.data.pages} total={state.data.total} onPage={(p) => setFilter((f) => ({ ...f, page: p }))} />
          </>
        )}
      </SectionCard>

      {pending && (
        <BugReportDetailDialog report={pending} busy={busy} onCancel={() => setPending(null)} onSave={save} />
      )}
    </AdminPage>
  );
}

function BugReportDetailDialog({
  report,
  busy,
  onCancel,
  onSave,
}: {
  report: AdminBugReport;
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: { status: BugReportStatus; admin_notes: string }) => Promise<void>;
}) {
  const [status, setStatus] = useState<BugReportStatus>(report.status);
  const [notes, setNotes] = useState(report.admin_notes ?? "");

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Bug report: ${report.title}`}>
      <div className="absolute inset-0 bg-scrim backdrop-blur-sm" onClick={onCancel} aria-hidden="true" />
      <GlassCard className="relative w-full max-w-lg p-6 animate-fade-up max-h-[90vh] overflow-y-auto scroll-slim">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-snow">{report.title}</h3>
            <p className="text-[13px] text-slate mt-0.5">
              {report.user?.full_name || "Unknown user"} · {report.user?.email ?? report.user_id.slice(0, 8)} · {timeAgo(report.created_at)}
            </p>
          </div>
          <StatusBadge value={report.status} />
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {report.category && (
            <span className="text-[12px] rounded-lg px-2.5 py-1 border border-line bg-tint-hi text-slate">
              {BUG_REPORT_CATEGORY_LABELS[report.category]}
            </span>
          )}
          <SeverityPill severity={report.severity} />
        </div>

        <div className="mt-4 space-y-4 text-sm">
          <div>
            <p className="text-[13px] font-semibold text-slate">What happened</p>
            <p className="text-snow leading-relaxed mt-1 whitespace-pre-wrap">{report.description}</p>
          </div>
          {report.steps_to_reproduce && (
            <div>
              <p className="text-[13px] font-semibold text-slate">Steps to reproduce</p>
              <p className="text-snow leading-relaxed mt-1 whitespace-pre-wrap">{report.steps_to_reproduce}</p>
            </div>
          )}
          {report.expected_behavior && (
            <div>
              <p className="text-[13px] font-semibold text-slate">Expected</p>
              <p className="text-snow leading-relaxed mt-1 whitespace-pre-wrap">{report.expected_behavior}</p>
            </div>
          )}
          {report.actual_behavior && (
            <div>
              <p className="text-[13px] font-semibold text-slate">Actual</p>
              <p className="text-snow leading-relaxed mt-1 whitespace-pre-wrap">{report.actual_behavior}</p>
            </div>
          )}
          {report.page_url && (
            <p className="text-[13px] text-slate">
              Page: <span className="font-mono text-snow break-all">{report.page_url}</span>
            </p>
          )}
          {report.user_agent && (
            <p className="text-[12px] text-muted break-all">Browser: {report.user_agent}</p>
          )}
        </div>

        <div className="mt-6 border-t border-line pt-4">
          <label className="text-[13px] uppercase tracking-wider text-slate font-medium block mb-1.5">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as BugReportStatus)} className="field" aria-label="Report status">
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          <label className="text-[13px] uppercase tracking-wider text-slate font-medium block mb-1.5 mt-4">Admin notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="field min-h-[96px]"
            placeholder="Internal notes (visible to admins only)"
            maxLength={4000}
          />
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => onSave({ status, admin_notes: notes.trim() })}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}