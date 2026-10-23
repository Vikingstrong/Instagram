// Overridden only by server-side tests; requests never provide the clock.
export const COINS_CLOCK = Symbol('COINS_CLOCK');
export const MAX_COIN_BALANCE = 9223372036854775807n;

// Asia/Dushanbe is UTC+05:00 (no daylight-saving changes in the supported era).
// Date key is evaluated AFTER acquiring the wallet lock, including at midnight.
export function coinWindow(now: Date) {
  const date = new Date(now.getTime() + 5 * 3600_000)
    .toISOString()
    .slice(0, 10);
  return {
    claimDate: new Date(`${date}T00:00:00.000Z`),
    nextClaimAt: new Date(`${date}T19:00:00.000Z`).toISOString(),
  };
}
