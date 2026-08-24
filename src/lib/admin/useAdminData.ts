"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError, adminFetch } from "./client";

type State<T> =
  | { status: "loading"; data: null; error: null; refresh: () => void }
  | { status: "error"; data: null; error: ApiClientError; refresh: () => void }
  | { status: "ready"; data: T; error: null; refresh: () => void };

export function useAdminData<T>(path: string | null): State<T> {
  const [state, setState] = useState<State<T>>(() => ({
    status: "loading",
    data: null,
    error: null,
    refresh: () => {},
  }));
  const [tick, setTick] = useState(0);
  const mounted = useRef(true);

  const refresh = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!path) return;
    mounted.current = true;
    let active = true;
    setState((s) => (s.status === "ready" ? s : { status: "loading", data: null, error: null, refresh }));
    adminFetch<T>(path)
      .then((data) => {
        if (!active) return;
        setState({ status: "ready", data, error: null, refresh });
      })
      .catch((err) => {
        if (!active) return;
        const e = err instanceof ApiClientError ? err : new ApiClientError(500, "Request failed.", "network");
        setState({ status: "error", data: null, error: e, refresh });
      });
    return () => {
      active = false;
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick]);

  return state;
}

export function useMaintenanceStatus() {
  const [maintenance, setMaintenance] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    const check = () =>
      fetch("/api/app/status")
        .then((r) => r.json())
        .then((body) => {
          if (!active) return;
          setMaintenance(Boolean(body?.maintenance));
          setLoaded(true);
        })
        .catch(() => {
          if (active) setLoaded(true);
        });
    check();
    const id = window.setInterval(check, 60000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  return { maintenance, loaded };
}
