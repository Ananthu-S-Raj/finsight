"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import Button from "@/components/ui/Button";
import Icon, { type IconName } from "@/components/ui/Icons";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/ToastProvider";
import { useRequireAuth } from "@/lib/useAuth";
import GoalCard from "@/components/GoalCard";
import GoalFormSheet from "@/components/GoalFormSheet";
import GoalDetailsSheet from "@/components/GoalDetailsSheet";
import ContributionSheet from "@/components/ContributionSheet";
import { listGoals } from "@/lib/goalsApi";
import { type Goal, type GoalStatus } from "@/lib/goals";
import { inr } from "@/lib/format";
import { listenRefresh } from "@/lib/events";
import { haptic } from "@/lib/haptics";

type Filter = "all" | Exclude<GoalStatus, "cancelled">;

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "paused", label: "Paused" },
  { key: "completed", label: "Done" },
];

export default function GoalsPage() {
  const userId = useRequireAuth();
  const toast = useToast();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [details, setDetails] = useState<Goal | null>(null);
  const [contributing, setContributing] = useState<Goal | null>(null);

  useEffect(() => {
    document.title = "Goals · FinSight";
  }, []);

  const load = useCallback(async () => {
    try {
      setGoals(await listGoals());
    } catch {
      toast.error("Couldn't load your goals.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (userId) load();
  }, [userId, load]);

  useEffect(() => listenRefresh(load), [load]);

  const visible = useMemo(() => {
    const list = goals.filter((g) => g.status !== "cancelled");
    if (filter === "all") return list;
    return list.filter((g) => g.status === filter);
  }, [goals, filter]);

  const totals = useMemo(() => {
    const active = goals.filter((g) => g.status !== "cancelled");
    const saved = active.reduce((sum, g) => sum + Number(g.current_amount), 0);
    const target = active.reduce((sum, g) => sum + Number(g.target_amount), 0);
    const completed = goals.filter((g) => g.status === "completed").length;
    const activeCount = active.filter((g) => g.status === "active").length;
    return { saved, target, completed, activeCount, pct: target > 0 ? (saved / target) * 100 : 0 };
  }, [goals]);

  function openNew() {
    setEditing(null);
    setSheetOpen(true);
  }

  function openEdit(goal: Goal) {
    setEditing(goal);
    setSheetOpen(true);
  }

  return (
    <AppShell userId={userId ?? ""} profile={null}>
      <PageHeader
        title="Goals"
        subtitle="Save toward what matters, one contribution at a time."
        icon="target"
        actions={
          <Button variant="primary" icon="plus" onClick={openNew}>
            New goal
          </Button>
        }
      />

      <div className="space-y-6">
        {!loading && goals.filter((g) => g.status !== "cancelled").length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="glass rounded-2xl p-4">
              <p className="text-[13px] uppercase tracking-widest text-slate font-medium">Saved</p>
              <p className="mt-1 text-xl font-bold tabular text-snow">{inr(totals.saved)}</p>
            </div>
            <div className="glass rounded-2xl p-4">
              <p className="text-[13px] uppercase tracking-widest text-slate font-medium">Target</p>
              <p className="mt-1 text-xl font-bold tabular text-snow">{inr(totals.target)}</p>
            </div>
            <div className="glass rounded-2xl p-4">
              <p className="text-[13px] uppercase tracking-widest text-slate font-medium">Active</p>
              <p className="mt-1 text-xl font-bold tabular text-snow">{totals.activeCount}</p>
            </div>
            <div className="glass rounded-2xl p-4">
              <p className="text-[13px] uppercase tracking-widest text-slate font-medium">Completed</p>
              <p className="mt-1 text-xl font-bold tabular text-snow">{totals.completed}</p>
            </div>
          </div>
        )}

        {loading ? (
          <ListSkeleton rows={5} />
        ) : goals.filter((g) => g.status !== "cancelled").length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center">
            <span className="mx-auto mb-4 inline-flex h-14 w-14 rounded-2xl glass items-center justify-center text-accent">
              <Icon name="target" size={24} />
            </span>
            <h3 className="text-lg font-semibold text-snow">No goals yet</h3>
            <p className="text-sm text-slate mt-1.5 max-w-sm mx-auto leading-relaxed">
              Set a target and a deadline — FinSight tracks your progress and reminds you before it slips away.
            </p>
            <Button variant="primary" icon="plus" className="mt-5" onClick={openNew}>
              Create your first goal
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => {
                    haptic("light");
                    setFilter(f.key);
                  }}
                  className={`neo-chip ${filter === f.key ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
                >
                  {f.label}
                  <span className="text-slate">
                    {f.key === "all"
                      ? goals.filter((g) => g.status !== "cancelled").length
                      : goals.filter((g) => g.status === f.key).length}
                  </span>
                </button>
              ))}
            </div>

            {visible.length === 0 ? (
              <p className="text-center text-sm text-slate py-8">
                Nothing here yet.
              </p>
            ) : (
              <div className="space-y-3">
                {visible.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    onOpen={(g) => {
                      haptic("light");
                      setDetails(g);
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <GoalFormSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        editing={editing}
        userId={userId ?? ""}
      />

      <GoalDetailsSheet
        open={details !== null}
        onClose={() => setDetails(null)}
        goal={details}
        onEdit={(goal) => {
          setDetails(null);
          openEdit(goal);
        }}
        onContribute={(goal) => {
          setDetails(null);
          setContributing(goal);
        }}
      />

      <ContributionSheet
        open={contributing !== null}
        onClose={() => setContributing(null)}
        goal={contributing}
      />
    </AppShell>
  );
}
