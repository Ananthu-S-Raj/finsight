// @vitest-environment node
import { describe, it, expect } from "vitest";
import { csvEscape, toCsv, todayStamp } from "@/lib/csv";

describe("csvEscape", () => {
  it("passes plain values through", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape(42)).toBe("42");
    expect(csvEscape(true)).toBe("true");
  });

  it("escapes commas by quoting the field", () => {
    expect(csvEscape("Doe, Jane")).toBe('"Doe, Jane"');
  });

  it("escapes quotes by doubling them inside a quoted field", () => {
    expect(csvEscape('He said "hi"')).toBe('"He said ""hi"""');
  });

  it("escapes newlines and carriage returns by quoting", () => {
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscape("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("renders null/undefined as empty cells", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("neutralizes formula injection for = + - @ prefixed strings", () => {
    expect(csvEscape("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
    expect(csvEscape("+SUM(A1:A2)")).toBe("'+SUM(A1:A2)");
    expect(csvEscape("-1")).toBe("'-1");
    expect(csvEscape("@import")).toBe("'@import");
    // Tab/CR are also spreadsheet trigger characters; the prefixed value
    // containing a control char is additionally quoted per RFC-4180.
    expect(csvEscape("\tcmd")).toBe("'\tcmd");
    expect(csvEscape("\rexec")).toBe('"\'\rexec"');
  });

  it("does not mangle legitimate numeric amounts", () => {
    // Numbers are rendered as-is: they are system-generated, never formulas.
    expect(csvEscape(-5)).toBe("-5");
    expect(csvEscape(120.5)).toBe("120.5");
  });

  it("preserves Unicode text", () => {
    expect(csvEscape("José Müñoz 東京 💰")).toBe("José Müñoz 東京 💰");
  });
});

describe("toCsv", () => {
  it("emits a header row plus data rows", () => {
    const csv = toCsv(["ID", "Name"], [[1, "Jane"], [2, "Joe"]]);
    expect(csv.slice(1).split("\r\n")).toEqual(["ID,Name", "1,Jane", "2,Joe"]);
  });

  it("starts with a UTF-8 BOM so spreadsheets detect the encoding", () => {
    const csv = toCsv(["Name"], [["Jane"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe("Name\r\nJane");
  });

  it("keeps embedded separators inside quoted fields intact on parse-back", () => {
    const csv = toCsv(["Note"], [["a,b\nc"]]);
    expect(csv).toBe('\uFEFFNote\r\n"a,b\nc"');
  });

  it("maps null cells to empty positions", () => {
    const csv = toCsv(["A", "B"], [[null, undefined]]);
    expect(csv).toBe("\uFEFFA,B\r\n,");
  });
});

describe("todayStamp", () => {
  it("returns the browser-local YYYY-MM-DD stamp", () => {
    const d = new Date(2026, 7, 22, 23, 30); // Aug 22 2026 local, late evening
    expect(todayStamp(d)).toBe("2026-08-22");
  });

  it("zero-pads month and day", () => {
    expect(todayStamp(new Date(2026, 0, 3))).toBe("2026-01-03");
  });
});
