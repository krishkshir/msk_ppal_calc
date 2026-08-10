/**
 * Money is always integer cents in this project, never floats — the
 * whole fee model is validated at cent precision against T1-T3
 * (CONSTITUTION.md "Observed transactions"), and float drift would
 * silently break that. Rounds ties toward positive infinity (2.5 -> 3,
 * -2.5 -> -2) — every amount in this domain is non-negative (settle()
 * throws rather than return a negative received amount), so in practice
 * this is always "round half up." Matches every observed transaction,
 * though none of T1-T3 land exactly on a half-cent so half-even hasn't
 * been ruled out either.
 */
export function roundHalfUpCents(cents: number): number {
  return Math.floor(cents + 0.5);
}
