import { describe, expect, it, beforeEach, vi } from "vitest";
import { mapPushPayload } from "@/lib/notifications";

describe("mapPushPayload", () => {
  it("maps budget pushes to the budget category and route", () => {
    const item = mapPushPayload({
      category: "budget",
      title: "Over budget",
      body: "You're over by ₹2,000.",
      url: "/budgets",
    });
    expect(item.category).toBe("budget");
    expect(item.icon).toBe("alert");
    expect(item.title).toBe("Over budget");
    expect(item.route).toBe("/budgets");
  });

  it("maps card pushes to payments", () => {
    expect(mapPushPayload({ category: "card" }).category).toBe("payments");
  });

  it("maps savings pushes to savings", () => {
    expect(mapPushPayload({ category: "savings" }).category).toBe("savings");
  });

  it("defaults unknown categories to system", () => {
    expect(mapPushPayload({ category: "weird" }).category).toBe("system");
    expect(mapPushPayload({}).category).toBe("system");
  });

  it("keeps safe fallback copy", () => {
    const item = mapPushPayload({});
    expect(item.title).toBe("FinSight");
    expect(item.message).toBe("");
    expect(item.route).toBeUndefined();
  });

  it("only accepts same-origin relative routes", () => {
    expect(
      mapPushPayload({ url: "https://evil.example/phish" }).route
    ).toBeUndefined();
    expect(mapPushPayload({ url: "/settings" }).route).toBe("/settings");
  });
});
