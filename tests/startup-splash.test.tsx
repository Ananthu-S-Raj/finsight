// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import StartupSplash from "@/components/StartupSplash";

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

describe("StartupSplash", () => {
  it("appears during initial application startup (before any auth resolves)", () => {
    // The splash takes no props and no network — it renders identically for
    // authenticated and unauthenticated cold starts.
    render(<StartupSplash />);
    const splash = screen.getByTestId("startup-splash");
    expect(splash).toBeInTheDocument();
    expect(splash.style.opacity).toBe("1");
  });

  it("fades out after initialization and normal content is shown", () => {
    render(
      <>
        <StartupSplash />
        <main data-testid="app-content">Dashboard</main>
      </>
    );

    // Still fully visible during the minimum display window.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByTestId("startup-splash").style.opacity).toBe("1");

    // After the minimum display time (rAF tick + 700ms) it enters the fade.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByTestId("startup-splash").style.opacity).toBe("0");

    // Once the fade completes it unmounts entirely; app content remains.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByTestId("startup-splash")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
  });

  it("never remains indefinitely — the hard cap removes it", () => {
    render(
      <>
        <StartupSplash />
        <main data-testid="app-content">Login</main>
      </>
    );
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByTestId("startup-splash")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
  });
});

describe("StartupSplash — only appears on first load of a tab session (Bug 4)", () => {
  it("shows on a genuine cold start (no prior splash in this session)", () => {
    render(<StartupSplash />);
    expect(screen.getByTestId("startup-splash")).toBeInTheDocument();
  });

  it("does NOT replay the splash when the layout remounts during navigation in the same session", () => {
    // Cold start: first page load of the tab shows the splash and records it
    // in sessionStorage.
    render(<StartupSplash />);
    expect(screen.getByTestId("startup-splash")).toBeInTheDocument();
    cleanup();

    // Navigating Home -> Analytics remounts the (shared) layout in the same
    // tab session. The splash must NOT appear again.
    render(<StartupSplash />);
    expect(screen.queryByTestId("startup-splash")).not.toBeInTheDocument();
  });

  it("does NOT replay the splash on a full page reload in the same tab (the reported 'every navigation' flash)", () => {
    // A full page load (manual reload, plain <a> navigation, PWA update
    // reload) remounts the root layout — previously the splash was baked into
    // the server HTML and flashed again for returning users. The decision must
    // be client-side and session-aware, so a reload in the same session shows
    // nothing.
    render(<StartupSplash />);
    expect(screen.getByTestId("startup-splash")).toBeInTheDocument();
    cleanup();

    render(<StartupSplash />);
    expect(screen.queryByTestId("startup-splash")).not.toBeInTheDocument();
    cleanup();

    // Even after the tabs' timers would have had time to run, still nothing.
    render(<StartupSplash />);
    expect(screen.queryByTestId("startup-splash")).not.toBeInTheDocument();
  });

  it("shows again in a brand-new session (fresh tab)", () => {
    // A navigation remount marks the splash as shown for this session...
    render(<StartupSplash />);
    cleanup();

    // ...but a brand-new browser session (new tab) clears sessionStorage and
    // must see the startup splash again on cold start.
    sessionStorage.clear();
    render(<StartupSplash />);
    expect(screen.getByTestId("startup-splash")).toBeInTheDocument();
  });

  it("emits NO splash markup and no timers for an already-shown session (no hydration flash)", () => {
    // Seed the session flag before mounting, exactly like a reload of a tab
    // that already saw the splash. The component must never render the splash
    // and must not schedule any fade/cap timers for it.
    sessionStorage.setItem("finsight:startup-splash-shown", "1");
    render(<StartupSplash />);
    expect(screen.queryByTestId("startup-splash")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(screen.queryByTestId("startup-splash")).not.toBeInTheDocument();
  });
});
