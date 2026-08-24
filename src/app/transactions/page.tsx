"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import TransactionRow from "@/components/TransactionRow";
import TransactionDetailSheet from "@/components/TransactionDetailSheet";
import TransactionsFilterSheet from "@/components/TransactionsFilterSheet";
import TransactionSortControl from "@/components/TransactionSortControl";
import { ListSkeleton } from "@/components/ui/Skeleton";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icons";
import { useToast } from "@/components/ui/ToastProvider";
import { useRequireAuth } from "@/lib/useAuth";
import { getProfile, type Profile } from "@/lib/finance";
import { useDebounce } from "@/lib/hooks";
import { useCategories } from "@/lib/useCategories";
import { listTransactions } from "@/lib/transactionsApi";
import { parseSearchParams, type TransactionFilters, type TransactionRow as TxRow } from "@/lib/transactions";
import { haptic } from "@/lib/haptics";

const PAGE_SIZE = 25;

type PageResult = {
  items: TxRow[];
  nextCursor: string | null;
};

function filtersFromURL(): { filters: TransactionFilters; search: string } {
  if (typeof window === "undefined") return { filters: {}, search: "" };
  const parsed = parseSearchParams(new URLSearchParams(window.location.search));
  const { search, ...rest } = parsed.filters;
  return { filters: rest, search: search ?? "" };
}

function activeFilterCount(f: TransactionFilters): number {
  return (
    (f.type ? 1 : 0) +
    (f.category ? 1 : 0) +
    (f.range ? 1 : 0) +
    (f.min !== undefined ? 1 : 0) +
    (f.max !== undefined ? 1 : 0)
  );
}

export default function TransactionsPage() {
  const userId = useRequireAuth();
  const toast = useToast();
  const { categories } = useCategories(userId);

  const initial = useMemo(filtersFromURL, []);
  const [filters, setFilters] = useState<TransactionFilters>(initial.filters);
  const [search, setSearch] = useState(initial.search);
  const debouncedSearch = useDebounce(search, 350);

  const [page, setPage] = useState<PageResult>({ items: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState<TxRow | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    document.title = "Transactions · FinSight";
  }, []);

  useEffect(() => {
    if (!userId) return;
    getProfile(userId).then(setProfile).catch(() => setProfile(null));
  }, [userId]);

  const effectiveFilters = useMemo<TransactionFilters>(() => {
    const merged: TransactionFilters = { ...filters };
    if (debouncedSearch.trim()) merged.search = debouncedSearch.trim();
    return merged;
  }, [filters, debouncedSearch]);

  const filterKey = useMemo(
    () => JSON.stringify(effectiveFilters),
    [effectiveFilters]
  );

  // Keep the URL in sync so filters survive reload/share.
  useEffect(() => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(effectiveFilters)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    const target = qs ? `/transactions?${qs}` : "/transactions";
    window.history.replaceState({}, "", target);
  }, [filterKey, effectiveFilters]);

  const loadFirstPage = useCallback(async () => {
    if (!userId) return;
    const id = ++requestId.current;
    setLoading(true);
    try {
      const res = await listTransactions(effectiveFilters, null, PAGE_SIZE);
      if (id !== requestId.current) return;
      setPage({ items: res.items, nextCursor: res.nextCursor });
    } catch {
      if (id !== requestId.current) return;
      toast.error("Couldn't load transactions.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [userId, effectiveFilters, toast]);

  // Load page 1 whenever any committed filter changes.
  useEffect(() => {
    loadFirstPage();
  }, [userId, filterKey, loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!userId || loadingMore || !page.nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await listTransactions(effectiveFilters, page.nextCursor, PAGE_SIZE);
      setPage((prev) => ({
        items: [...prev.items, ...res.items],
        nextCursor: res.nextCursor,
      }));
    } catch {
      toast.error("Couldn't load more transactions.");
    } finally {
      setLoadingMore(false);
    }
  }, [userId, loadingMore, page.nextCursor, effectiveFilters, toast]);

  const applyFilters = useCallback((next: TransactionFilters) => {
    setFilters(next);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
    setSearch("");
  }, []);

  const count = activeFilterCount(filters);
  const hasActive = count > 0 || Boolean(debouncedSearch.trim());

  return (
    <AppShell
      userId={userId ?? ""}
      profile={profile ? { full_name: profile.full_name, email: profile.email, role: profile.role } : null}
    >
      <PageHeader
        title="Transactions"
        subtitle="Every entry, searchable."
        icon="transactions"
      />

      <div className="space-y-4 animate-fade-up">
        {/* Search */}
        <div className="glass rounded-2xl p-3 flex flex-col gap-3">
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate">
              <Icon name="search" size={16} />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search merchants, notes, categories…"
              enterKeyHint="search"
              className="field !pl-10 !py-2.5 !text-base"
              aria-label="Search transactions"
            />
            {search && (
              <button
                onClick={() => {
                  setSearch("");
                  haptic("light");
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate hover:text-snow"
                aria-label="Clear search"
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <TransactionSortControl
              order={effectiveFilters.order ?? "date"}
              direction={effectiveFilters.direction ?? "desc"}
              onChange={(order, direction) => setFilters((f) => ({ ...f, order, direction }))}
            />
            <Button
              variant={hasActive ? "primary" : "neo"}
              icon="filter"
              iconSize={16}
              onClick={() => setFilterOpen(true)}
              className="shrink-0 !px-3.5"
              aria-label="Filter transactions"
            >
              {hasActive ? `Filter${count ? ` · ${count}` : ""}` : "Filter"}
            </Button>
          </div>
        </div>

        {loading ? (
          <ListSkeleton rows={8} />
        ) : page.items.length === 0 ? (
          <div className="glass rounded-2xl p-10 flex flex-col items-center text-center gap-3">
            <span className="h-14 w-14 rounded-2xl glass items-center justify-center inline-flex text-slate">
              <Icon name="transactions" size={24} />
            </span>
            <p className="font-semibold text-snow">
              {hasActive ? "Nothing matches that." : "No transactions yet"}
            </p>
            <p className="text-sm text-slate max-w-xs">
              {hasActive
                ? "Try a different search or filter."
                : "Tap the + button to add your first expense or income."}
            </p>
            {hasActive && (
              <Button variant="ghost" onClick={clearFilters} className="mt-1">
                Clear search & filters
              </Button>
            )}
          </div>
        ) : (
          <>
            <p className="text-[13px] text-slate px-1">
              {page.items.length}
              {page.nextCursor ? "+" : ""} shown{hasActive ? " · filtered" : ""}
            </p>
            <div className="space-y-2.5">
              {page.items.map((t) => (
                <TransactionRow key={t.id} tx={t} onOpen={(tx) => setSelected(tx as TxRow)} />
              ))}
            </div>
            {page.nextCursor && (
              <Button
                variant="default"
                full
                disabled={loadingMore}
                onClick={loadMore}
                className="!py-3.5"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            )}
          </>
        )}
      </div>

      <TransactionsFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        categories={categories}
        onApply={applyFilters}
        onClear={clearFilters}
      />

      <TransactionDetailSheet
        tx={selected}
        onClose={() => setSelected(null)}
        userId={userId ?? ""}
      />
    </AppShell>
  );
}
