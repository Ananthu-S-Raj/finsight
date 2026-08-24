import { describe, it, expect } from "vitest";
import { decodeJwtPayload, jwtIssuedBefore } from "@/lib/jwt";

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

const NOW_MS = Date.now();

describe("decodeJwtPayload", () => {
  it("decodes a well-formed payload", () => {
    const p = decodeJwtPayload(makeJwt({ sub: "user-1", iat: 1000 }));
    expect(p).toEqual({ sub: "user-1", iat: 1000 });
  });

  it("returns null for a non-string / empty token", () => {
    expect(decodeJwtPayload("")).toBeNull();
    expect(decodeJwtPayload(null as unknown as string)).toBeNull();
    expect(decodeJwtPayload(undefined as unknown as string)).toBeNull();
  });

  it("returns null for a token with fewer than two segments", () => {
    expect(decodeJwtPayload("header.only")).toBeNull();
    expect(decodeJwtPayload("onetwothree")).toBeNull();
  });

  it("returns null for a token with a non-JSON payload", () => {
    expect(decodeJwtPayload(`${b64url("{}")}.${b64url("not-json")}.s`)).toBeNull();
  });

  it("survives payloads with base64url padding removed", () => {
    const p = decodeJwtPayload(makeJwt({ sub: "user-1" }));
    expect(p?.sub).toBe("user-1");
  });
});

describe("jwtIssuedBefore — session freshness", () => {
  it("returns false when no timestamp is provided", () => {
    expect(jwtIssuedBefore(makeJwt({ iat: 1000 }), null)).toBe(false);
    expect(jwtIssuedBefore(makeJwt({ iat: 1000 }), undefined)).toBe(false);
  });

  it("returns false for a token without a numeric iat", () => {
    expect(jwtIssuedBefore(makeJwt({ sub: "x" }), NOW_MS)).toBe(false);
    expect(jwtIssuedBefore(makeJwt({ iat: "not-a-number" }), NOW_MS)).toBe(false);
    expect(jwtIssuedBefore(makeJwt({ iat: Number.NaN }), NOW_MS)).toBe(false);
  });

  it("returns true when iat is strictly before the invalidation time", () => {
    const issuedAt = Math.floor((NOW_MS - 60_000) / 1000);
    expect(jwtIssuedBefore(makeJwt({ iat: issuedAt }), NOW_MS)).toBe(true);
  });

  it("returns false when iat equals the invalidation time (not strictly before)", () => {
    const same = Math.floor(NOW_MS / 1000);
    expect(jwtIssuedBefore(makeJwt({ iat: same }), same * 1000)).toBe(false);
  });

  it("returns false for a token issued after the invalidation time", () => {
    const issuedAt = Math.floor((NOW_MS + 60_000) / 1000);
    expect(jwtIssuedBefore(makeJwt({ iat: issuedAt }), NOW_MS)).toBe(false);
  });

  it("treats the boundary second correctly (iat 1s before → stale)", () => {
    // iat at second S, invalidation at (S * 1000 + 1) ms → issued strictly before.
    const issuedAt = Math.floor(NOW_MS / 1000);
    expect(jwtIssuedBefore(makeJwt({ iat: issuedAt }), issuedAt * 1000 + 1)).toBe(true);
  });
});
