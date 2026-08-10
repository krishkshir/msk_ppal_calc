/**
 * Money is always integer minor units in this project, never floats —
 * the whole fee model is validated at cent precision against T1-T3
 * (CONSTITUTION.md "Observed transactions"), and float drift would
 * silently break that. "Minor units" is cents for a 2-decimal currency
 * (USD, CAD, ...) but whole yen for JPY, which has no minor decimal
 * unit — see currencies.ts's minorUnitExponent. Rounds ties toward
 * positive infinity (2.5 -> 3, -2.5 -> -2) — every amount in this domain
 * is non-negative (settle() throws rather than return a negative
 * received amount), so in practice this is always "round half up."
 * Matches every observed transaction, though none of T1-T3 land exactly
 * on a half-cent so half-even hasn't been ruled out either.
 */
export function roundHalfUp(minorUnits: number): number {
  return Math.floor(minorUnits + 0.5);
}
