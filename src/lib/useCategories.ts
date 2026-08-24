"use client";

import { useCallback, useEffect, useState } from "react";
import { listCategories } from "./categoriesApi";
import type { Category } from "./categories";

type CacheEntry = { categories: Category[]; at: number };
const TTL_MS = 10 * 60 * 1000;

// Module-level cache so the categories picker is shared across sheets/pages
// within a tab session; each session cache is keyed by user id.
const sessionCache = new Map<string, CacheEntry>();

function cached(userId: string): Category[] | null {
  const entry = sessionCache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    sessionCache.delete(userId);
    return null;
  }
  return entry.categories;
}

function store(userId: string, categories: Category[]): void {
  sessionCache.set(userId, { categories, at: Date.now() });
}

/**
 * Loads the canonical categories list, caching it per session so every picker
 * shares the same list without refetching.
 */
export function useCategories(userId: string | null | undefined) {
  const [categories, setCategories] = useState<Category[]>(() =>
    userId ? cached(userId) ?? [] : []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (uid: string) => {
    try {
      const list = await listCategories();
      store(uid, list);
      setCategories(list);
      setError(null);
      return list;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load categories.");
      return null;
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    const existing = cached(userId);
    if (existing) {
      setCategories(existing);
      return;
    }
    setLoading(true);
    refresh(userId).finally(() => setLoading(false));
  }, [userId, refresh]);

  return { categories, loading, error, refresh };
}
