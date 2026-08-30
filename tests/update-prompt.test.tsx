// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import UpdatePrompt from "@/components/UpdatePrompt";

/**
 * Fake service-worker surface matching what UpdatePrompt depends on:
 *   navigator.serviceWorker.controller
 *   navigator.serviceWorker.ready -> registration.update()
 *   navigator.serviceWorker.addEventListener("message" | "controllerchange", ...)
 *
 * We drive the auto-update lifecycle directly:
 *   - postVersion(v)   -> new worker reports its version on activate
 *   - fireControl()    -> the new worker takes control (controllerchange)
 *
 * window.location.reload is stubbed so we can assert auto-reload happens
 * exactly once per genuine update.
 */
function installSWMock(opts: {
  controller?: boolean;
  prePending?: string | null;
  preAnnounced?: string | null;
}) {
  const msgHandlers = new Set<(event: { data: unknown }) => void>();
  const controlHandlers = new Set<() => void>();
  const updateSpy = vi.fn(async () => {});

  const sw: unknown = {
    controller: opts.controller ? ({} as ServiceWorker) : null,
    ready: Promise.resolve({ update: updateSpy }),
    addEventListener: (t: string, cb: (event?: unknown) => void) => {
      if (t === "message") msgHandlers.add(cb as (event: { data: unknown }) => void);
      if (t === "controllerchange") controlHandlers.add(cb as () => void);
    },
    removeEventListener: (t: string, cb: (event?: unknown) => void) => {
      if (t === "message") msgHandlers.delete(cb as (event: { data: unknown }) => void);
      if (t === "controllerchange") controlHandlers.delete(cb as () => void);
    },
  };

  if (opts.prePending != null) localStorage.setItem("finsight:sw:pending-version", opts.prePending);
  if (opts.preAnnounced != null) localStorage.setItem("finsight:sw:announced-version", opts.preAnnounced);

  return {
    sw,
    updateSpy,
    postVersion(version: string) {
      for (const h of msgHandlers) h({ data: { type: "finsight-version", version } });
    },
    fireControl() {
      for (const h of controlHandlers) h();
    },
  };
}

const reloadSpy = vi.fn();

beforeEach(() => {
  cleanup();
  localStorage.clear();
  reloadSpy.mockClear();
  vi.stubGlobal("location", { ...window.location, reload: reloadSpy });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // Resolve any pending ready().update() microtasks so unhandled-rejection
  // noise does not leak between tests.
  vi.clearAllTimers();
});

async function renderWithMock(opts: { controller?: boolean; prePending?: string | null; preAnnounced?: string | null }) {
  const controls = installSWMock(opts);
  vi.stubGlobal("navigator", { ...navigator, serviceWorker: controls.sw });
  render(<UpdatePrompt />);
  // Let the effect run and its `ready.then(...)` microtask resolve.
  await Promise.resolve();
  await Promise.resolve();
  return controls;
}

describe("UpdatePrompt — auto-update lifecycle", () => {
  it("does nothing on a first install (no prior controller): no reload, no notice, no permission", async () => {
    await renderWithMock({ controller: false });
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/FinSight has been updated/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("checks for a newly deployed service worker on load via registration.update()", async () => {
    const { updateSpy } = await renderWithMock({ controller: true });
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it("auto-reloads exactly once when a new worker takes control, storing the pending version", async () => {
    const { fireControl, postVersion } = await renderWithMock({ controller: true });
    postVersion("finsight-v6");
    fireControl();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("finsight:sw:pending-version")).toBe("finsight-v6");
  });

  it("does not loop: firing controllerchange repeatedly reloads only once", async () => {
    const { fireControl } = await renderWithMock({ controller: true });
    fireControl();
    fireControl();
    fireControl();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it("announces 'FinSight has been updated' once after the auto-update reload", async () => {
    await renderWithMock({ controller: true, prePending: "finsight-v6" });

    expect(screen.getByText(/FinSight has been updated/i)).toBeInTheDocument();
    // The pending marker is consumed so a plain reload does not re-announce.
    expect(localStorage.getItem("finsight:sw:pending-version")).toBeNull();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("shows no notice on an ordinary reload (no pending marker)", async () => {
    await renderWithMock({ controller: true });
    expect(screen.queryByText(/FinSight has been updated/i)).not.toBeInTheDocument();
  });

  it("never announces the same version twice (per-version dedupe)", async () => {
    await renderWithMock({ controller: true, prePending: "finsight-v6", preAnnounced: "finsight-v6" });
    expect(screen.queryByText(/FinSight has been updated/i)).not.toBeInTheDocument();
    expect(localStorage.getItem("finsight:sw:pending-version")).toBeNull();
  });

  it("announces a newer version even if an older one was already announced", async () => {
    await renderWithMock({ controller: true, prePending: "finsight-v7", preAnnounced: "finsight-v6" });
    expect(screen.getByText(/FinSight has been updated/i)).toBeInTheDocument();
  });

  it("requests no notification permission", async () => {
    const requestSpy = vi.fn(async () => "granted");
    vi.stubGlobal("Notification", { permission: "granted", requestPermission: requestSpy });
    await renderWithMock({ controller: true, prePending: "finsight-v6" });
    expect(requestSpy).not.toHaveBeenCalled();
  });
});
