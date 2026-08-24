"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import Button from "@/components/ui/Button";
import Icon, { type IconName } from "@/components/ui/Icons";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/ToastProvider";
import { useRequireAuth } from "@/lib/useAuth";
import {
  billEventsForMonth,
  monthGrid,
  monthRange,
  monthTotals,
  recurringEventsForMonth,
  transactionEvent,
  WEEKDAY_LABELS,
  type CalendarEvent,
} from "@/lib/calendar";
import { listRecurring, listPendingOccurrences } from "@/lib/recurringApi";
import { listBills } from "@/lib/billsApi";
import { listTransactions, type TransactionRow } from "@/lib/transactionsApi";
import { prettyDate } from "@/lib/recurring";
import { inr, monthName } from "@/lib/format";
import { listenRefresh } from "@/lib/events";
import { haptic } from "@/lib/haptics";

function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function eventTone(e: CalendarEvent): { dot: string; chip: string; label: string } {
  if (e.kind === "bill") {
    if (e.billStatus === "overdue") {
      return { dot: "#ef4444", chip: "bg-red-500/15 text-red-300", label: "Overdue" };
    }
    if (e.billStatus === "paid") {
      return { dot: "#10b981", chip: "bg-emerald-500/15 text-emerald-300", label: "Paid" };
    }
    if (e.billStatus === "due") {
      return { dot: "#f59e0b", chip: "bg-amber-500/15 text-amber-300", label: "Due today" };
    }
    return { dot: "#f59e0b", chip: "bg-amber-500/15 text-amber-200", label: "Bill" };
  }
  if (e.kind === "recurring") {
    if (e.income) return { dot: "#10b981", chip: "bg-emerald-500/15 text-emerald-300", label: "Income" };
    if (e.pending) return { dot: "#8b5cf6", chip: "bg-violet-500/15 text-violet-300", label: "Awaiting" };
    return { dot: "#6366f1", chip: "bg-indigo-500/15 text-indigo-300", label: "Recurring" };
  }
  if (e.income) return { dot: "#10b981", chip: "bg-emerald-500/15 text-emerald-300", label: "Income" };
  if (e.isCreditCard) return { dot: "#8b5cf6", chip: "bg-violet-500/15 text-violet-300", label: "Card" };
  return { dot: "#ef4444", chip: "bg-red-500/15 text-red-300", label: "Expense" };
}

function EventIcon({ e }: { e: CalendarEvent }) {
  const name: IconName = e.kind === "bill" ? "creditCard" : e.kind === "recurring" ? "recurring" : e.income ? "income" : e.isCreditCard ? "card" : "expense";
  return <Icon name={name} size={15} />;
}

export default function CalendarPage() {
  const userId = useRequireAuth();
  const toast = useToast();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState<string | null>(todayStr());
  const [txns, setTxns] = useState<TransactionRow[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Calendar · FinSight";
  }, []);

  const load = useCallback(
    async (y: number, m: number) => {
      const { start, endExclusive } = monthRange(y, m);
      try {
        const [txRes, rules, pending, bills] = await Promise.all([
          listTransactions({ range: `[${start},${endExclusive})`, order: "date", direction: "asc" }, null, 100),
          listRecurring(),
          listPendingOccurrences(),
          listBills(),
        ]);
        const today = todayStr();
        const txEvents = txRes.items.map(transactionEvent);
        const recurring = recurringEventsForMonth(rules, pending, start, endExclusive);
        const bill = billEventsForMonth(bills, start, endExclusive, today);
        setEvents([...txEvents, ...recurring, ...bill]);
        setTxns(txRes.items);
      } catch {
        toast.error("Couldn't load your calendar.");
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    load(year, month);
  }, [userId, year, month, load]);

  useEffect(() => listenRefresh(() => load(year, month)), [load, year, month]);

  const { start, endExclusive } = monthRange(year, month);
  const grid = useMemo(() => monthGrid(year, month), [year, month]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      if (e.date < start || e.date >= endExclusive) continue;
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.kind === "bill" ? -1 : 0) - (b.kind === "bill" ? -1 : 0) || a.title.localeCompare(b.title));
    }
    return map;
  }, [events, start, endExclusive]);

  const totals = useMemo(() => monthTotals(txns), [txns]);
  const billsDue = useMemo(
    () => events.filter((e) => e.kind === "bill" && e.billStatus !== "paid" && e.billStatus !== "cancelled").reduce((s, e) => s + e.amount, 0),
    [events]
  );
  const dayEvents = selected ? byDay.get(selected) ?? [] : [];

  function shift(delta: number) {
    haptic("light");
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  function goToday() {
    haptic("light");
    const d = new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setSelected(todayStr());
  }

  return (
    <AppShell userId={userId ?? ""} profile={null}>
      <PageHeader
        title="Calendar"
        subtitle="Transactions, schedules and bills — one view."
        icon="calendar"
      />

      <div className="space-y-6">
        <div className="glass rounded-2xl p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <button
              type="button"
              onClick={() => shift(-1)}
              className="neo h-10 w-10 rounded-xl inline-flex items-center justify-center text-slate hover:text-snow"
              aria-label="Previous month"
            >
              <Icon name="chevronLeft" size={18} />
            </button>
            <div className="text-center min-w-0">
              <p className="text-base font-bold text-snow tabular">{monthName(new Date(year, month, 1))} {year}</p>
            </div>
            <button
              type="button"
              onClick={() => shift(1)}
              className="neo h-10 w-10 rounded-xl inline-flex items-center justify-center text-slate hover:text-snow"
              aria-label="Next month"
            >
              <Icon name="chevronRight" size={18} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-2">
            {WEEKDAY_LABELS.map((w) => (
              <div key={w} className="text-center text-[11px] font-semibold uppercase tracking-widest text-slate">
                {w.slice(0, 2)}
              </div>
            ))}
          </div>

          {loading ? (
            <ListSkeleton rows={6} />
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {grid.flat().map((date, i) => {
                const dayEvents = byDay.get(date) ?? [];
                const inMonth = date >= start && date < endExclusive;
                const isToday = date === todayStr();
                const isSelected = date === selected;
                const overdue = dayEvents.some((e) => e.kind === "bill" && e.billStatus === "overdue");
                return (
                  <button
                    key={date + i}
                    type="button"
                    onClick={() => setSelected(date)}
                    aria-label={`${date}, ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}`}
                    className={`min-w-0 rounded-xl p-1 sm:p-1.5 text-left transition-colors ${
                      isSelected ? "bg-accent/20 ring-1 ring-accent/40" : inMonth ? "hover:bg-tint-hi" : "opacity-40 hover:bg-tint-hi"
                    }`}
                  >
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-lg text-[12px] font-semibold tabular ${
                        isToday ? "bg-accent text-white" : inMonth ? "text-snow" : "text-slate"
                      }`}
                    >
                      {Number(date.slice(8, 10))}
                    </span>
                    <span className="mt-1 flex flex-col gap-[3px]">
                      {dayEvents.slice(0, 3).map((e) => (
                        <span
                          key={e.id}
                          className="h-[5px] w-full rounded-full"
                          style={{ background: eventTone(e).dot }}
                          title={`${e.title} — ${inr(e.amount)}`}
                        />
                      ))}
                      {overdue && <span className="h-[5px] w-full rounded-full" style={{ background: "#ef4444" }} />}
                      {dayEvents.length > 4 && (
                        <span className="text-[10px] font-medium text-slate tabular">+{dayEvents.length - 4}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex items-center justify-center">
            <Button variant="default" className="btn-sm" onClick={goToday}>
              Today
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <SummaryCard label="Income" value={inr(totals.income)} tone="text-emerald" />
          <SummaryCard label="Spent" value={inr(totals.expenses)} tone="text-danger" />
          <SummaryCard label="Net" value={inr(totals.net)} tone={totals.net >= 0 ? "text-snow" : "text-danger"} />
        </div>

        <div className="glass-soft rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="h-9 w-9 rounded-lg bg-amber-500/15 inline-flex items-center justify-center text-amber">
              <Icon name="creditCard" size={16} />
            </span>
            <div>
              <p className="text-sm font-semibold text-snow">Bills due this month</p>
              <p className="text-[13px] text-slate">Unpaid bills and scheduled ones</p>
            </div>
          </div>
          <p className="text-lg font-bold tabular text-amber">{inr(billsDue)}</p>
        </div>

        {selected && (
          <section aria-label="Day detail">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="text-[13px] uppercase tracking-widest text-slate font-medium">
                {prettyDate(selected)}
              </h2>
              <span className="text-[13px] text-slate tabular">
                {dayEvents.length} event{dayEvents.length === 1 ? "" : "s"}
              </span>
            </div>
            {dayEvents.length === 0 ? (
              <div className="glass rounded-2xl p-6 text-center">
                <p className="text-sm text-slate">Nothing scheduled on this day.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {dayEvents.map((e) => {
                  const tone = eventTone(e);
                  return (
                    <div key={e.id} className="glass-soft rounded-2xl p-4 flex items-center gap-3">
                      <span className={`h-10 w-10 rounded-xl inline-flex items-center justify-center shrink-0 ${tone.chip}`}>
                        <EventIcon e={e} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-snow truncate">{e.title}</p>
                        <p className="text-[13px] text-slate truncate">
                          {tone.label}
                          {e.note ? ` · ${e.note}` : ""}
                          {e.kind === "bill" && e.billStatus === "due" ? " · Due today" : ""}
                        </p>
                      </div>
                      <p className={`text-base font-bold tabular shrink-0 ${e.income ? "text-emerald" : e.expense ? "text-danger" : "text-snow"}`}>
                        {e.income ? "+" : "−"}{inr(e.amount)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="glass rounded-2xl p-3.5">
      <p className="text-[12px] uppercase tracking-widest text-slate font-medium">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular ${tone}`}>{value}</p>
    </div>
  );
}
