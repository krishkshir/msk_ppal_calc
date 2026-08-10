import { afterEach, describe, expect, it, vi } from "vitest";
import { getFxRateToUSD } from "./frankfurter";

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const response = {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.status === 500 ? "Internal Server Error" : "OK",
    json: () => Promise.resolve(body),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(response as unknown as Response),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getFxRateToUSD", () => {
  it("requests base=payCurrency&quotes=USD and returns the rate already in USD-per-unit terms", async () => {
    mockFetchOnce([{ date: "2026-08-10", base: "CAD", quote: "USD", rate: 0.71427 }]);

    const result = await getFxRateToUSD("CAD");

    expect(result).toEqual({ rate: 0.71427, asOf: "2026-08-10" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.frankfurter.dev/v2/rates?base=CAD&quotes=USD",
    );
  });

  it("throws on a non-ok HTTP response rather than returning a stale/empty rate", async () => {
    mockFetchOnce([], { ok: false, status: 500 });

    await expect(getFxRateToUSD("CAD")).rejects.toThrow(/Frankfurter request failed/);
  });

  it("throws if the response array doesn't contain the expected base/quote pair", async () => {
    mockFetchOnce([{ date: "2026-08-10", base: "EUR", quote: "USD", rate: 1.08 }]);

    await expect(getFxRateToUSD("CAD")).rejects.toThrow(/Unexpected Frankfurter response shape/);
  });
});
