"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMonthSummary,
  getProfile,
  getRecentTransactions,
  type Profile,
  type Transaction,
} from "./finance";
import { listenRefresh } from "./events";
import { useToast } from "@/components/ui/ToastProvider";

export type Summary = {
  spent: number;
  budget: number;
  remaining: number;
  isOverspent: boolean;
};

export function usePageData(userId: string | null, txnLimit = 50) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<Summary>({
    spent: 0,
    budget: 0,
    remaining: 0,
    isOverspent: false,
  });
  const [loading, setLoading] = useState(true);
  const profileRef = useRef<Profile | null>(null);
  const toast = useToast();

  const refresh = useCallback(
    async (uid: string) => {
      try {
        // Fetch profile and transactions in parallel, then compute the month
        // summary. The summary stays a dedicated database query: recent
        // transactions are capped at txnLimit so they cannot reliably yield the
        // full current-month total (removing the query would under-count for
        // months with more than txnLimit expenses).
        const [p, t] = await Promise.all([
          getProfile(uid),
          getRecentTransactions(uid, txnLimit),
        ]);
        const s = await getMonthSummary(uid, p.monthly_budget);
        profileRef.current = p;
        setProfile(p);
        setTxns(t);
        setSummary(s);
        setLoading(false);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "FinSight couldn't connect right now.";
        if (/Failed to fetch|Network|timed out|fetch|Invalid/i.test(msg)) {
          toast.warning("FinSight couldn't connect right now. Check your network.");
        }
        // Keep the skeleton visible until data actually loads so pages never
        // crash on missing profile data.
        if (profileRef.current === null) {
          setLoading(true);
        }
      }
    },
    [toast, txnLimit]
  );

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    refresh(userId);
    const off = listenRefresh(() => refresh(userId));
    return off;
  }, [userId, refresh]);

  return { profile, txns, summary, loading, refresh };
}
