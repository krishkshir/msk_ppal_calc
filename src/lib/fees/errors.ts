/** Translates engine.ts's thrown Error messages (written for developers) into plain language. */
export function describeCalculationError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("cannot return a negative received amount")) {
    return "That amount is too small — PayPal's fee alone would exceed it. Try a larger amount.";
  }
  return "That amount can't be calculated right now.";
}
