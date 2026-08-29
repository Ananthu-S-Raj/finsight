// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import UpdatePrompt from "@/components/UpdatePrompt";

/**
 * Fake service-worker surface matching what UpdatePrompt depends on:
 *   navigator.serviceWorker.controller
 *   navigator.serviceWorker.ready  -> registration
 *   navigator.serviceWorker.addEventListener("message", ...)
 *   registration.installing + registration.addEventListener("updatefound", ...)
 * We drive the update lifecycle manually: fire a message, transition the
 * installing worker to "installed", then post the version message.
 */
function installSWMock(opts: { controller?: boolean; prePrompted?: string | null }) {
  const msgHandlers = new Set<(event: { data: unknown }) => void>();
  let updatefoundHandler: (() => void) | null = null;
  let stateHandler: (() => void) | null = null;

  const installing = {
    state: "installing",
    addEventListener: (_t: string, cb: () => void) => {
      stateHandler = cb;
    },
  } as unknown as ServiceWorker;

  const registration = {
    installing,
    addEventListener: (t: string, cb: () => void) => {
      if (t === "updatefound") updatefoundHandler = cb;
    },
  } as unknown as ServiceWorkerRegistration;

  const sw: unknown = {
    controller: opts.controller ? ({} as ServiceWorker) : null,
    ready: Promise.resolve(registration),
    addEventListener: (t: string, cb: (event: { data: unknown }) => void) => {
      if (t === "message") msgHandlers.add(cb);
    },
    removeEventListener: (t: string, cb: (event: { data: unknown }) => void) => {
      if (t === "message") msgHandlers.delete(cb);
    },
  };

  if (opts.prePrompted != null) {
    localStorage.setItem("finsight:sw:prompted-version", opts.prePrompted);
  }

  return {
    sw,
    /** Post a finsight-version message to every registered handler. */
    postVersion(version: string) {
      for (const h of msgHandlers) h({ data: { type: "finsight-version", version } });
    },
    /** Simulate an update being found and its worker installing. */
    simulateUpdateFound() {
      updatefoundHandler?.();
      installing.state = "installed"; // a new worker reaches the installed state
      stateHandler?.();
    },
  };
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

afterEach(() => {
  // Unmount first (runs effect cleanups) while the mock navigator is still in
  // place, then restore the real globals.
  cleanup();
  vi.unstubAllGlobals();
});

describe("UpdatePrompt — PWA update banner", () => {
  async function renderWithMock(opts: { controller?: boolean; prePrompted?: string | null }) {
    const { sw, ...controls } = installSWMock(opts);
    // Replaces the whole navigator object (jsdom's real serviceWorker property
    // is non-configurable), matching the existing matchMedia stub pattern.
    vi.stubGlobal("navigator", { ...navigator, serviceWorker: sw });
    render(<UpdatePrompt />);
    // Let the effect's `navigator.serviceWorker.ready.then(...)` microtask run
    // so `updatefound` / `statechange` handlers are attached before we drive
    // the lifecycle below.
    await Promise.resolve();
    await Promise.resolve();
    return controls;
  }

  it("does not show on a first install (no prior controller)", async () => {
    await renderWithMock({ controller: false });
    expect(screen.queryByRole("button", { name: /reload/i })).not.toBeInTheDocument();
  });

  it("shows the banner when a new version activates while an old one controls the page", async () => {
    const { simulateUpdateFound, postVersion } = await renderWithMock({ controller: true });

    // An update is found: installing worker reaches `installed`, then the new
    // worker posts its version on activate.
    simulateUpdateFound();
    postVersion("finsight-v5");

    expect(await screen.findByText(/new version of FinSight is available/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
    expect(localStorage.getItem("finsight:sw:prompted-version")).toBe("finsight-v5");
  });

  it("does not show the same version again once prompted (per-version dedupe)", async () => {
    const { simulateUpdateFound, postVersion } = await renderWithMock({
      controller: true,
      prePrompted: "finsight-v5",
    });

    simulateUpdateFound();
    postVersion("finsight-v5");

    expect(screen.queryByRole("button", { name: /reload/i })).not.toBeInTheDocument();
  });

  it("dismiss closes the banner and does not auto-reload", async () => {
    const { simulateUpdateFound, postVersion } = await renderWithMock({ controller: true });

    simulateUpdateFound();
    postVersion("finsight-v6");
    expect(await screen.findByRole("button", { name: /reload/i })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Dismiss update notice"));
    expect(screen.queryByRole("button", { name: /reload/i })).not.toBeInTheDocument();
  });
});
