import { vi } from "vitest";

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  get length() {
    return this.m.size;
  }
}

function mediaQueryStub() {
  return {
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  };
}

if (typeof window === "undefined") {
  // Node environment: provide the tiny DOM surface the libs touch.
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("window", {
    matchMedia: () => mediaQueryStub(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    dispatchEvent: vi.fn(),
  });
} else {
  // jsdom: polyfill only the APIs jsdom does not implement.
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      value: () => mediaQueryStub(),
      writable: true,
    });
  }
  if (!window.requestAnimationFrame) {
    Object.defineProperty(window, "requestAnimationFrame", {
      value: (cb: () => void) => setTimeout(cb, 0),
      writable: true,
    });
  }
  if (!window.cancelAnimationFrame) {
    Object.defineProperty(window, "cancelAnimationFrame", {
      value: (id: number) => clearTimeout(id),
      writable: true,
    });
  }
}
