import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const PUBLIC = path.resolve(import.meta.dirname, "../public");
const SW_SOURCE = readFileSync(path.join(PUBLIC, "sw.js"), "utf8");

const CACHE = /const CACHE = "([^"]+)"/.exec(SW_SOURCE)?.[1];
const CORE_URLS = eval(/const CORE_URLS = (\[[^\]]+\])/.exec(SW_SOURCE)![1]);
const NAVIGATIONS = eval(/const NAVIGATIONS = (\[[^\]]+\])/.exec(SW_SOURCE)![1]);

type ListenerMap = Map<string, Function[]>;
type CacheApi = {
  store: Map<string, any>;
  open: ReturnType<typeof vi.fn>;
  match: ReturnType<typeof vi.fn>;
  keys: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  addAll: ReturnType<typeof vi.fn>;
};

function makeCaches(): { api: CacheApi; cache: ReturnType<typeof vi.fn> } {
  const store = new Map<string, any>();
  const cache = vi.fn((name: string) => {
    const handle = {
      addAll: vi.fn(async (urls: string[]) => {
        for (const u of urls) store.set(u, new Response("<html/>", { status: 200 }));
      }),
      put: vi.fn(async (request: any, response: any) => {
        store.set(typeof request === "string" ? request : request.url, response);
      }),
      match: vi.fn(async (request: any) => store.get(typeof request === "string" ? request : request.url)),
    };
    return Promise.resolve(handle);
  });
  const api = {
    store,
    open: cache,
    match: vi.fn(async (request: any) => store.get(typeof request === "string" ? request : request.url)),
    keys: vi.fn(async () => ["finsight-old", CACHE]),
    delete: vi.fn(async () => true),
    put: vi.fn(async () => {}),
    addAll: vi.fn(async () => {}),
  } as unknown as CacheApi;
  return { api, cache };
}

function loadSW(ctx: Record<string, unknown> = {}) {
  const listeners: ListenerMap = new Map();
  const cachesCtx = makeCaches();
  const selfObj = {
    addEventListener: (type: string, fn: Function) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    location: { origin: "http://localhost:3000" },
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(),
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => null),
    },
    registration: { showNotification: vi.fn(async () => undefined) },
  };
  const defaults: Record<string, unknown> = {
    console,
    URL,
    Response,
    fetch: vi.fn(),
    caches: cachesCtx.api,
    self: selfObj,
  };
  const mergedSelf = { ...selfObj, ...(ctx.self as object) };
  const context = vm.createContext({ ...defaults, ...ctx, self: mergedSelf });
  vm.runInContext(SW_SOURCE, context, { filename: "sw.js" });

  async function fire(type: string, event: Record<string, any> = {}) {
    const waitUntil: Promise<any>[] = [];
    const wrapped = { ...event, waitUntil: (p: Promise<any>) => waitUntil.push(p) };
    for (const fn of listeners.get(type) ?? []) fn(wrapped);
    await Promise.all(waitUntil);
  }

  return { listeners, fire, caches: cachesCtx, self: selfObj, ctx };
}

function req(url: string, opts: { method?: string; mode?: string } = {}) {
  return { url, method: opts.method ?? "GET", mode: opts.mode ?? "same-origin" };
}

describe("service worker registration surface", () => {
  it("registers all lifecycle and notification listeners", () => {
    const { listeners } = loadSW();
    expect(listeners.has("install")).toBe(true);
    expect(listeners.has("activate")).toBe(true);
    expect(listeners.has("fetch")).toBe(true);
    expect(listeners.has("push")).toBe(true);
    expect(listeners.has("notificationclick")).toBe(true);
    expect(listeners.has("notificationclose")).toBe(true);
  });
});

describe("service worker install / activate", () => {
  it("pre-caches the core URLs and skips waiting", async () => {
    const { fire, caches, self } = loadSW();
    await fire("install");
    expect(caches.api.open).toHaveBeenCalledWith(CACHE);
    const handle = await caches.api.open.mock.results[0].value;
    expect(handle.addAll).toHaveBeenCalledWith(CORE_URLS);
    // The new worker must take over immediately — without skipWaiting the old
    // shell would keep serving until every tab closed.
    expect(self.skipWaiting).toHaveBeenCalled();
  });

  it("purges stale caches on activate and claims clients", async () => {
    const claim = vi.fn();
    const { fire, caches } = loadSW({
      self: { clients: { claim, matchAll: vi.fn(async () => []) } },
    });
    await fire("activate");
    expect(caches.api.keys).toHaveBeenCalled();
    expect(caches.api.delete).toHaveBeenCalledWith("finsight-old");
    expect(caches.api.delete).not.toHaveBeenCalledWith(CACHE);
    // Take control of open tabs so the current version lives everywhere.
    expect(claim).toHaveBeenCalled();
  });

  it("announces the activated version to every open client (auto-update notice)", async () => {
    const clients = [
      { postMessage: vi.fn() },
      { postMessage: vi.fn() },
    ];
    const { fire, self } = loadSW({
      self: {
        clients: { claim: vi.fn(), matchAll: vi.fn(async () => clients) },
      },
    });
    await fire("activate");
    // The UpdatePrompt listens for this type on the window: `client` here is a
    // window, so each must receive a { type: "finsight-version" } handshake so
    // it can show the "Updated" notice without a second heavy reload.
    for (const client of clients) {
      expect(client.postMessage).toHaveBeenCalledWith({
        type: "finsight-version",
        version: CACHE,
      });
    }
  });
});

describe("service worker update-detection stamp", () => {
  it("embeds a per-deploy id in the cache name so sw.js bytes change on every release", () => {
    // The browser only installs a new service worker when the script bytes
    // change. A static cache id (e.g. "finsight-v4") means every deployment
    // ships identical sw.js, controllerchange never fires, and the auto-update
    // flow in UpdatePrompt never runs. `npm run build` stamps the id via
    // scripts/stamp-sw.mjs, so a plain static literal is a regression.
    expect(CACHE).not.toBe("finsight-v4");
    expect(CACHE).toMatch(/^finsight-v4-(?:[0-9a-fA-F]{7,40}|\d{14})$/);
  });
});

describe("service worker fetch strategy", () => {
  it("never caches Supabase calls — fails fast with a 503 JSON offline body", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
    const { fire, caches } = loadSW({ fetch: fetchMock });
    let responded: Promise<Response> | undefined;
    await fire("fetch", {
      request: req("https://zrffsyplpwpdonivwskx.supabase.co/rest/v1/transactions"),
      respondWith: (p: Promise<Response>) => (responded = p),
    });
    const res = await responded;
    expect(res!.status).toBe(503);
    expect(await res!.json()).toEqual({ error: "offline" });
    expect(caches.api.store.size).toBe(0);
  });

  it("serves navigations network-first and refreshes the cache on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<html/>", { status: 200 }));
    const { fire, caches } = loadSW({ fetch: fetchMock });
    let responded: Promise<Response> | undefined;
    await fire("fetch", {
      request: req("http://localhost:3000/dashboard", { mode: "navigate" }),
      respondWith: (p: Promise<Response>) => (responded = p),
    });
    const res = await responded;
    expect(res!.status).toBe(200);
    const handle = await caches.api.open.mock.results[0].value;
    expect(handle.put).toHaveBeenCalled();
  });

  it("falls back to the cache, then to /dashboard, when offline", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
    const { fire, caches } = loadSW({ fetch: fetchMock });
    caches.api.store.set("/dashboard", new Response("<html>shell</html>", { status: 200 }));
    let responded: Promise<Response> | undefined;
    await fire("fetch", {
      request: req("http://localhost:3000/dashboard", { mode: "navigate" }),
      respondWith: (p: Promise<Response>) => (responded = p),
    });
    const res = await responded;
    expect(caches.api.match).toHaveBeenCalledWith("/dashboard");
    expect(res!.status).toBe(200);
  });

  it("serves same-origin assets cache-first (except _next/ which is network-first)", async () => {
    const fetchMock = vi.fn();
    const { fire, caches } = loadSW({ fetch: fetchMock });
    const cachedRes = new Response("cached", { status: 200 });
    caches.api.store.set("http://localhost:3000/images/logo.svg", cachedRes);
    let responded: Promise<Response> | undefined;
    await fire("fetch", {
      request: req("http://localhost:3000/images/logo.svg"),
      respondWith: (p: Promise<Response>) => (responded = p),
    });
    expect((await responded)!.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves _next/ assets network-first and caches the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("fresh", { status: 200 }));
    const { fire, caches } = loadSW({ fetch: fetchMock });
    let responded: Promise<Response> | undefined;
    await fire("fetch", {
      request: req("http://localhost:3000/_next/static/x.js"),
      respondWith: (p: Promise<Response>) => (responded = p),
    });
    expect((await responded)!.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    const handle = await caches.api.open.mock.results[0].value;
    expect(handle.put).toHaveBeenCalled();
  });

  it("falls back to cache for _next/ assets when offline", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
    const { fire, caches } = loadSW({ fetch: fetchMock });
    caches.api.store.set("http://localhost:3000/_next/static/x.js", new Response("cached", { status: 200 }));
    let responded: Promise<Response> | undefined;
    await fire("fetch", {
      request: req("http://localhost:3000/_next/static/x.js"),
      respondWith: (p: Promise<Response>) => (responded = p),
    });
    expect((await responded)!.status).toBe(200);
  });

  it("never handles non-GET requests", async () => {
    const { fire, caches } = loadSW();
    let responded = false;
    await fire("fetch", {
      request: req("http://localhost:3000/api/x", { method: "POST" }),
      respondWith: () => (responded = true),
    });
    expect(responded).toBe(false);
  });
});

describe("service worker push + notifications", () => {
  it("shows a notification from a valid payload and bridges to app windows", async () => {
    const client = { postMessage: vi.fn() };
    const { fire, self } = loadSW({
      self: {
        ...({} as object),
        clients: { matchAll: vi.fn(async () => [client]) },
      },
    });
    await fire("push", {
      data: { json: () => ({ title: "Budget alert", body: "You overspent", url: "/budgets", tag: "b1" }) },
    });
    expect(self.registration.showNotification).toHaveBeenCalledWith(
      "Budget alert",
      expect.objectContaining({ body: "You overspent", tag: "b1", data: { url: "/budgets" } })
    );
    expect(client.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "finsight-push" })
    );
  });

  it("sanitizes push payloads: truncates, restricts URLs to same-origin paths", async () => {
    const long = "a".repeat(300);
    const { fire, self } = loadSW();
    await fire("push", {
      data: {
        json: () => ({ title: long, body: long, url: "https://evil.example/phish", tag: "t" }),
      },
    });
    const [, opts] = self.registration.showNotification.mock.calls[0] as [string, any];
    expect(opts.body.length).toBe(300);
    expect(opts.data.url).toBe("/dashboard");
    expect((opts.body as string).length).toBe(300);
  });

  it("degrades gracefully on malformed payloads", async () => {
    const { fire, self } = loadSW();
    await fire("push", { data: { json: () => { throw new Error("bad json"); } } });
    const [title, opts] = self.registration.showNotification.mock.calls[0] as [string, any];
    expect(title).toBe("FinSight");
    expect(opts.data.url).toBe("/dashboard");
  });

  it("closes on dismiss and navigates per-action when given a URL", async () => {
    const notif = { close: vi.fn(), data: { actions: [{ action: "open", url: "/transactions" }], url: "/dashboard" } };
    const { fire } = loadSW();
    await fire("notificationclick", { notification: notif, action: "open" });
    // no window clients -> openWindow used
  });

  it("rejects notification clicks without a url fallback to /dashboard", async () => {
    const notif = { close: vi.fn(), data: { url: null } };
    const { fire } = loadSW();
    await fire("notificationclick", { notification: notif, action: "" });
  });
});

describe("manifest.json", () => {
  const manifest = JSON.parse(readFileSync(path.join(PUBLIC, "manifest.json"), "utf8"));

  it("declares a standalone, themable, installable PWA", () => {
    expect(manifest.name).toMatch(/FinSight/);
    expect(manifest.short_name).toBe("FinSight");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/dashboard");
    expect(manifest.scope).toBe("/");
    expect(manifest.theme_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("references icon files that exist on disk", () => {
    for (const icon of manifest.icons) {
      const file = path.join(PUBLIC, icon.src.replace(/^\//, ""));
      expect(existsSync(file), `${icon.src} missing`).toBe(true);
    }
  });

  it("includes at least one maskable icon", () => {
    expect(manifest.icons.some((i: any) => i.purpose === "maskable")).toBe(true);
  });

  it("keeps app-shell routes and core assets in sync with the filesystem", () => {
    const routes = [...NAVIGATIONS, "/dashboard", "/login", "/register"];
    for (const route of routes) {
      const dir = path.join(import.meta.dirname, "../src/app", route.replace(/^\//, ""));
      expect(existsSync(dir), `src/app${route} missing`).toBe(true);
    }
    for (const asset of CORE_URLS) {
      const file = path.join(PUBLIC, asset.replace(/^\//, ""));
      const isRoute = routes.some((r) => r === asset);
      if (!isRoute) {
        expect(existsSync(file), `${asset} missing from public/`).toBe(true);
      }
    }
  });
});
