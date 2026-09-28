/**
 * When a stop can take no more work at the door — the one rule every delivery screen and the home's
 * job list share. Pure (no React, no SQLite) so the home's rules in `home.ts` run under vitest;
 * `local.ts` re-exports it for the screens that already import it from there.
 */
export function isStopTerminal(state: string): boolean {
  return state === 'delivered' || state === 'partial' || state === 'failed' || state === 'skipped'
}
