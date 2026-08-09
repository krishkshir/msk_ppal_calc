/**
 * Money is always integer cents in this project, never floats — the
 * whole fee model is validated at cent precision against T1-T3
 * (CONSTITUTION.md "Observed transactions"), and float drift would
 * silently break that. Rounds half-up (ties away from zero), which
 * matches every observed transaction but hasn't been distinguished from
 * half-even by them, since none of T1-T3 land exactly on a half-cent.
 */
export function roundHalfUpCents(cents: number): number {
  return Math.floor(cents + 0.5);
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}
