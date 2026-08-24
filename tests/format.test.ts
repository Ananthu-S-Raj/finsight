import { describe, expect, it } from "vitest";
import { inr, timeAgo, firstName, maskValue } from "@/lib/format";

describe("inr", () => {
  it("formats Indian grouping", () => {
    expect(inr(45230)).toBe("₹45,230");
    expect(inr(100000)).toBe("₹1,00,000");
    expect(inr(1234567)).toBe("₹12,34,567");
  });

  it("formats cents when requested", () => {
    expect(inr(100.5, { cents: true })).toBe("₹100.50");
  });

  it("compacts lakhs and crores", () => {
    expect(inr(150000, { compact: true })).toBe("₹1.50L");
    expect(inr(25000000, { compact: true })).toBe("₹2.50Cr");
    expect(inr(4500, { compact: true })).toBe("₹4.5k");
  });

  it("handles non-finite values safely", () => {
    expect(inr(NaN)).toBe("₹0");
    expect(inr(Infinity)).toBe("₹0");
  });
});

describe("timeAgo", () => {
  it("renders relative labels", () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 30000).toISOString())).toBe("just now");
    expect(timeAgo(new Date(now - 5 * 60000).toISOString())).toBe("5m ago");
    expect(timeAgo(new Date(now - 3 * 3600000).toISOString())).toBe("3h ago");
    expect(timeAgo(new Date(now - 2 * 86400000).toISOString())).toBe("2d ago");
  });
});

describe("firstName", () => {
  it("splits full names", () => {
    expect(firstName("Ananthu")).toBe("Ananthu");
    expect(firstName("Ananthu Kumar")).toBe("Ananthu");
    expect(firstName("  ")).toBe("friend");
  });
});

describe("maskValue", () => {
  it("masks balances to k", () => {
    expect(maskValue(45230)).toBe("₹45k");
    expect(maskValue(0)).toBe("₹0k");
  });
});
