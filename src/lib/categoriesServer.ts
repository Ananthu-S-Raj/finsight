/**
 * Server-side operations for the canonical categories list. Categories are
 * admin-managed; this endpoint only reads them for pickers and reference pages.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthApiError } from "@/lib/auth/errors";
import type { Category } from "./categories";

export async function dbListCategories(client: SupabaseClient): Promise<Category[]> {
  const { data, error } = await client
    .from("categories")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw new AuthApiError(502, "Couldn't load categories.", "db_error");
  return (data ?? []) as Category[];
}
