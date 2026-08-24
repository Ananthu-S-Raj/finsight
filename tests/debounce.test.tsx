// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDebounce } from "@/lib/hooks";

describe("useDebounce", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the value immediately, then updates after the delay", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }: { v: string }) => useDebounce(v, 350), {
      initialProps: { v: "a" },
    });
    expect(result.current).toBe("a");

    rerender({ v: "b" });
    expect(result.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(result.current).toBe("b");
  });

  it("coalesces rapid changes into a single update", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }: { v: string }) => useDebounce(v, 200), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    vi.advanceTimersByTime(100);
    rerender({ v: "c" });
    vi.advanceTimersByTime(100);
    expect(result.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe("c");
  });

  it("clears the pending timer when the value settles early", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }: { v: string }) => useDebounce(v, 200), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe("b");

    // A later change starts a fresh timer.
    rerender({ v: "d" });
    vi.advanceTimersByTime(100);
    expect(result.current).toBe("b");
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe("d");
  });
});
