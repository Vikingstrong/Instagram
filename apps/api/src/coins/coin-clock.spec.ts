import { coinWindow } from './coin-clock.js';

describe('Dushanbe daily eligibility calendar', () => {
  it.each([
    ['2026-10-23T18:59:59.999Z', '2026-10-23', '2026-10-23T19:00:00.000Z'],
    ['2026-10-23T19:00:00.000Z', '2026-10-24', '2026-10-24T19:00:00.000Z'],
    ['2026-12-31T19:00:00.000Z', '2027-01-01', '2027-01-01T19:00:00.000Z'],
    ['2028-02-28T19:00:00.000Z', '2028-02-29', '2028-02-29T19:00:00.000Z'],
  ])(
    'uses the local date, including calendar boundaries: %s',
    (instant, day, next) => {
      const now = new Date(instant),
        result = coinWindow(now);
      expect(result.claimDate.toISOString().slice(0, 10)).toBe(day);
      expect(result.nextClaimAt).toBe(next);
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Dushanbe',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      expect(formatter.format(now)).toBe(day);
    },
  );
});
