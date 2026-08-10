import { describe, expect, it } from "vitest";
import { decodeBreakdownParams, encodeBreakdownParams, type SharedBreakdown } from "./breakdown-link";

describe("encodeBreakdownParams / decodeBreakdownParams — round trip", () => {
  it("USD (no FX): encodes without fx/on, decodes back to the same value", () => {
    const input: SharedBreakdown = {
      grossPaidCents: 10_000,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      scheduleAsOf: "2026-05-28",
    };
    const query = encodeBreakdownParams(input);
    expect(query).not.toContain("fx=");
    expect(query).not.toContain("on=");

    const decoded = decodeBreakdownParams(Object.fromEntries(new URLSearchParams(query)));
    expect(decoded).toEqual({ ok: true, value: input });
  });

  it("CAD (with FX): round-trips the frozen rate and its date", () => {
    const input: SharedBreakdown = {
      grossPaidCents: 100_000,
      payCurrency: "CAD",
      buyerMarket: "OTHER",
      fx: { rate: 0.7312, asOf: "2026-08-10" },
      scheduleAsOf: "2026-05-28",
    };
    const query = encodeBreakdownParams(input);
    const decoded = decodeBreakdownParams(Object.fromEntries(new URLSearchParams(query)));
    expect(decoded).toEqual({ ok: true, value: input });
  });
});

describe("decodeBreakdownParams — rejects malformed or tampered input", () => {
  const valid = { gross: "10000", cur: "USD", mkt: "OTHER", sched: "2026-05-28" };

  it("rejects a missing gross", () => {
    const { gross, ...rest } = valid;
    expect(decodeBreakdownParams(rest)).toEqual({ ok: false, reason: "gross is missing" });
  });

  it("rejects a non-integer gross", () => {
    expect(decodeBreakdownParams({ ...valid, gross: "100.5" })).toEqual({
      ok: false,
      reason: "gross must be a non-negative integer",
    });
  });

  it("rejects a negative gross", () => {
    expect(decodeBreakdownParams({ ...valid, gross: "-1" })).toEqual({
      ok: false,
      reason: "gross must be a non-negative integer",
    });
  });

  it("rejects an unknown currency", () => {
    expect(decodeBreakdownParams({ ...valid, cur: "XXX" })).toEqual({
      ok: false,
      reason: "cur must be one of USD, CAD",
    });
  });

  it("rejects a missing currency", () => {
    const { cur, ...rest } = valid;
    expect(decodeBreakdownParams(rest)).toEqual({ ok: false, reason: "cur is missing" });
  });

  it("rejects an unknown buyer market", () => {
    expect(decodeBreakdownParams({ ...valid, mkt: "MARS" })).toEqual({
      ok: false,
      reason: "mkt must be one of UAE, EEA_UK, OTHER",
    });
  });

  it("rejects a missing schedule date", () => {
    const { sched, ...rest } = valid;
    expect(decodeBreakdownParams(rest)).toEqual({ ok: false, reason: "sched is missing" });
  });

  it("rejects a malformed schedule date", () => {
    expect(decodeBreakdownParams({ ...valid, sched: "not-a-date" })).toEqual({
      ok: false,
      reason: "sched must be a YYYY-MM-DD date",
    });
  });

  it("rejects fx present alongside cur=USD", () => {
    expect(decodeBreakdownParams({ ...valid, fx: "0.73", on: "2026-08-10" })).toEqual({
      ok: false,
      reason: "fx and on must be absent when cur is USD",
    });
  });

  it("rejects fx missing when cur is not USD", () => {
    expect(decodeBreakdownParams({ ...valid, cur: "CAD" })).toEqual({
      ok: false,
      reason: "fx is required when cur is not USD",
    });
  });

  it("rejects a non-positive fx rate", () => {
    expect(decodeBreakdownParams({ ...valid, cur: "CAD", fx: "0", on: "2026-08-10" })).toEqual({
      ok: false,
      reason: "fx must be a positive, finite number",
    });
  });

  it("rejects a non-finite fx rate", () => {
    expect(decodeBreakdownParams({ ...valid, cur: "CAD", fx: "Infinity", on: "2026-08-10" })).toEqual({
      ok: false,
      reason: "fx must be a positive, finite number",
    });
  });

  it("rejects a missing fx date (on) when cur is not USD", () => {
    expect(decodeBreakdownParams({ ...valid, cur: "CAD", fx: "0.73" })).toEqual({
      ok: false,
      reason: "on is required when cur is not USD",
    });
  });

  it("rejects a malformed fx date (on)", () => {
    expect(
      decodeBreakdownParams({ ...valid, cur: "CAD", fx: "0.73", on: "yesterday" }),
    ).toEqual({ ok: false, reason: "on must be a YYYY-MM-DD date" });
  });

  it("takes the first value when a param is repeated (array form)", () => {
    expect(decodeBreakdownParams({ ...valid, gross: ["10000", "99999"] })).toEqual({
      ok: true,
      value: {
        grossPaidCents: 10_000,
        payCurrency: "USD",
        buyerMarket: "OTHER",
        scheduleAsOf: "2026-05-28",
      },
    });
  });
});
