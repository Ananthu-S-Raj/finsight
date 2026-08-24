"use client";

export const REFRESH_EVENT = "finsight:refresh";

/** Fire after any mutation so open pages can refetch without coupling. */
export function emitRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
}

export function listenRefresh(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(REFRESH_EVENT, handler);
  return () => window.removeEventListener(REFRESH_EVENT, handler);
}
