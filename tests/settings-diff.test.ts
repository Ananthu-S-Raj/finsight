import { describe, it, expect } from "vitest";
import { hasSettingChanges, normalizeSettingValue } from "@/lib/admin/settingsDiff";

const FIELDS = [
  { key: "app_name", kind: "text" as const },
  { key: "maintenance_mode", kind: "toggle" as const },
  { key: "budget_alert_threshold", kind: "number" as const },
  { key: "provider", kind: "select" as const },
];

describe("normalizeSettingValue", () => {
  it("normalizes toggles to booleans", () => {
    expect(normalizeSettingValue("toggle", true)).toBe("true");
    expect(normalizeSettingValue("toggle", undefined)).toBe("false");
    expect(normalizeSettingValue("toggle", 1)).toBe("true");
  });

  it("normalizes numbers across representations", () => {
    expect(normalizeSettingValue("number", "90")).toBe(normalizeSettingValue("number", 90));
    expect(normalizeSettingValue("number", "")).toBe("0");
  });

  it("treats text/select as strings with null-ish fallback", () => {
    expect(normalizeSettingValue("text", null)).toBe("");
    expect(normalizeSettingValue("select", "ollama")).toBe("ollama");
  });
});

describe("hasSettingChanges (F-13)", () => {
  const initial = { app_name: "FinSight", maintenance_mode: false, budget_alert_threshold: 90, provider: "ollama" };

  it("is false when draft equals initial", () => {
    expect(hasSettingChanges(FIELDS, initial, { ...initial })).toBe(false);
  });

  it("is false when draft is empty", () => {
    expect(hasSettingChanges(FIELDS, initial, {})).toBe(false);
  });

  it("is true when one field changes", () => {
    expect(hasSettingChanges(FIELDS, initial, { ...initial, app_name: "Other" })).toBe(true);
  });

  it("returns to false when a change is reverted to the original value", () => {
    const changed = { ...initial, maintenance_mode: true };
    expect(hasSettingChanges(FIELDS, initial, changed)).toBe(true);
    expect(hasSettingChanges(FIELDS, initial, { ...changed, maintenance_mode: false })).toBe(false);
  });

  it("ignores keys that are not declared fields", () => {
    // Server may return extras such as last_health_check — they must not
    // mark the form dirty.
    expect(hasSettingChanges(FIELDS, initial, { ...initial, last_health_check: "2026-08-21T00:00:00Z" })).toBe(false);
  });

  it("coerces number-string edits so typing the same number is not a change", () => {
    expect(hasSettingChanges(FIELDS, initial, { ...initial, budget_alert_threshold: "90" })).toBe(false);
    expect(hasSettingChanges(FIELDS, initial, { ...initial, budget_alert_threshold: 80 })).toBe(true);
  });
});
