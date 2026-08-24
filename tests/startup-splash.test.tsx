// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import StartupSplash from "@/components/StartupSplash";

beforeEach(() => {
  cleanup();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
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
