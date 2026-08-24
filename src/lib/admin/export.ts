import { adminFetch, type Paged } from "./client";
import { downloadCsv, toCsv, todayStamp } from "@/lib/csv";

export const EXPORT_PAGE_SIZE = 100;

/**
 * Hard ceiling for one export: at most 40 pages of 100 rows (4,000 records).
 * Exports re-fetch through the authorized admin API with every active
 * filter preserved, so this bound keeps a stray request from walking an
 * unbounded result set while still covering realistic console datasets.
 */
export const EXPORT_MAX_PAGES = 40;

/** Fetch all pages of a filtered list and download them as a CSV file.
 *  Returns the exported row count. Throws on the first failed page. */
export async function exportPagedToCsv<T>(opts: {
  basePath: string;
  filenamePrefix: string;
  columns: readonly string[];
  row: (item: T) => ReadonlyArray<unknown>;
}): Promise<number> {
  const rows: unknown[][] = [];
  let pages = 1;
  for (let page = 1; page <= Math.min(pages, EXPORT_MAX_PAGES); page++) {
    const sep = opts.basePath.includes("?") ? "&" : "?";
    const res = await adminFetch<Paged<T>>(`${opts.basePath}${sep}pageSize=${EXPORT_PAGE_SIZE}&page=${page}`);
    pages = res.pages ?? 1;
    rows.push(...(res.items ?? []).map((item) => [...opts.row(item)]));
  }
  downloadCsv(`${opts.filenamePrefix}-${todayStamp()}.csv`, toCsv(opts.columns, rows));
  return rows.length;
}
