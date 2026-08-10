import { describe, expect, it } from "vitest";
import { decodeBreakdownParams, encodeBreakdownParams, type SharedBreakdown } from "./breakdown-link";
import { CURRENCIES } from "../fees/currencies";
import { BUYER_MARKETS } from "../fees/markets";

describe("encodeBreakdownParams / decodeBreakdownParams — round trip", () => {
  it("USD (no FX): encodes without fx/on, decodes back to the same value", () => {
    const input: SharedBreakdown = {
      grossPaidMinorUnits: 10_000,
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
      grossPaidMinorUnits: 100_000,
      payCurrency: "CAD",
      buyerMarket: "OTHER",
      fx: { rate: 0.7312, asOf: "2026-08-10" },
      scheduleAsOf: "2026-05-28",
    };
    const query = encodeBreakdownParams(input);
    const decoded = decodeBreakdownParams(Object.fromEntries(new URLSearchParams(query)));
    expect(decoded).toEqual({ ok: true, value: input });
  });

  it("a v0.3-era link (only USD/CAD ever existed) still decodes under the widened v0.4 currency set", () => {
    const query = "gross=100000&cur=CAD&mkt=OTHER&sched=2026-05-28&fx=0.7312&on=2026-08-10";
    const decoded = decodeBreakdownParams(Object.fromEntries(new URLSearchParams(query)));
    expect(decoded).toEqual({
      ok: true,
      value: {
        grossPaidMinorUnits: 100_000,
        payCurrency: "CAD",
        buyerMarket: "OTHER",
        fx: { rate: 0.7312, asOf: "2026-08-10" },
        scheduleAsOf: "2026-05-28",
      },
    });
  });

  it("a pre-fix link with no frozen fee/net/spread still decodes, with frozen absent", () => {
    const query = "gross=100000&cur=CAD&mkt=OTHER&sched=2026-05-28&fx=0.7312&on=2026-08-10";
    const decoded = decodeBreakdownParams(Object.fromEntries(new URLSearchParams(query)));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value.frozen).toBeUndefined();
  });

  it("USD with a frozen fee/net (no spread): round-trips", () => {
    const input: SharedBreakdown = {
      grossPaidMinorUnits: 10_000,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      scheduleAsOf: "2026-05-28",
      frozen: { feeMinorUnits: 493, netMinorUnits: 9_507 },
    };
    const query = encodeBreakdownParams(input);
    const decoded = decodeBreakdownParams(Object.fromEntries(new URLSearchParams(query)));
    expect(decoded).toEqual({ ok: true, value: input });
  });

  it("CAD with a frozen fee/net/spread: round-trips", () => {
    const input: SharedBreakdown = {
      grossPaidMinorUnits: 100_000,
      payCurrency: "CAD",
      buyerMarket: "OTHER",
      fx: { rate: 0.73, asOf: "2026-08-10" },
      scheduleAsOf: "2026-05-28",
      frozen: { feeMinorUnits: 4655, netMinorUnits: 66_818, spreadMinorUnits: 2784 },
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
      reason: `cur must be one of ${CURRENCIES.map((c) => c.code).join(", ")}`,
    });
  });

  it("rejects a missing currency", () => {
    const { cur, ...rest } = valid;
    expect(decodeBreakdownParams(rest)).toEqual({ ok: false, reason: "cur is missing" });
  });

  it("rejects an unknown buyer market", () => {
    expect(decodeBreakdownParams({ ...valid, mkt: "MARS" })).toEqual({
      ok: false,
      reason: `mkt must be one of ${BUYER_MARKETS.join(", ")}`,
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
        grossPaidMinorUnits: 10_000,
        payCurrency: "USD",
        buyerMarket: "OTHER",
        scheduleAsOf: "2026-05-28",
      },
    });
  });

  it("rejects an empty gross rather than silently coercing it to 0", () => {
    expect(decodeBreakdownParams({ ...valid, gross: "" })).toEqual({
      ok: false,
      reason: "gross is missing",
    });
  });

  it("rejects a schedule date that doesn't exist on the calendar (Date.parse day-rollover)", () => {
    expect(decodeBreakdownParams({ ...valid, sched: "2026-02-30" })).toEqual({
      ok: false,
      reason: "sched must be a YYYY-MM-DD date",
    });
  });

  it("rejects an fx date that doesn't exist on the calendar (Date.parse day-rollover)", () => {
    expect(
      decodeBreakdownParams({ ...valid, cur: "CAD", fx: "0.73", on: "2026-04-31" }),
    ).toEqual({ ok: false, reason: "on must be a YYYY-MM-DD date" });
  });

  it("rejects fee present without net", () => {
    expect(decodeBreakdownParams({ ...valid, fee: "100" })).toEqual({
      ok: false,
      reason: "fee and net must both be present or both be absent",
    });
  });

  it("rejects net present without fee", () => {
    expect(decodeBreakdownParams({ ...valid, net: "9900" })).toEqual({
      ok: false,
      reason: "fee and net must both be present or both be absent",
    });
  });

  it("rejects a non-integer fee", () => {
    expect(decodeBreakdownParams({ ...valid, fee: "100.5", net: "9900" })).toEqual({
      ok: false,
      reason: "fee must be a non-negative integer",
    });
  });

  it("rejects a negative net", () => {
    expect(decodeBreakdownParams({ ...valid, fee: "100", net: "-1" })).toEqual({
      ok: false,
      reason: "net must be a non-negative integer",
    });
  });

  it("rejects spread present alongside cur=USD, even with fee/net present", () => {
    expect(decodeBreakdownParams({ ...valid, fee: "100", net: "9900", spread: "50" })).toEqual({
      ok: false,
      reason: "spread must be absent when cur is USD",
    });
  });

  it("rejects spread missing when cur is not USD and fee/net are present", () => {
    expect(
      decodeBreakdownParams({
        ...valid,
        cur: "CAD",
        fx: "0.73",
        on: "2026-08-10",
        fee: "4655",
        net: "66818",
      }),
    ).toEqual({ ok: false, reason: "spread is required when cur is not USD and fee/net are present" });
  });

  it("rejects a non-integer spread", () => {
    expect(
      decodeBreakdownParams({
        ...valid,
        cur: "CAD",
        fx: "0.73",
        on: "2026-08-10",
        fee: "4655",
        net: "66818",
        spread: "27.5",
      }),
    ).toEqual({ ok: false, reason: "spread must be a non-negative integer" });
  });

  it("rejects a stray spread with fee and net both absent", () => {
    expect(decodeBreakdownParams({ ...valid, spread: "50" })).toEqual({
      ok: false,
      reason: "spread must be absent when fee and net are absent",
    });
  });
});
