import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoinAmountSchema, CoinWalletResponseSchema, coinsEndpoints } from '../dist/index.js';

test('coin strings preserve integers above JS number precision and reject unsafe wire representations', () => {
  assert.equal(CoinAmountSchema.parse('9007199254740993'), '9007199254740993');
  assert.equal(CoinAmountSchema.parse('9223372036854775807'), '9223372036854775807');
  for (const value of [100, '-1', '01', '1.5', '1e3', '9223372036854775808', '100000000000000000000']) assert.equal(CoinAmountSchema.safeParse(value).success, false);
});
test('wallet declares exact fixed daily rules and has no arbitrary transfer endpoint', () => {
  const response = { wallet: { balance: '0', serverTime: '2026-10-23T12:00:00.000Z', dailyReward: { amount: '100', timeZone: 'Asia/Dushanbe', claimed: false, nextClaimAt: '2026-10-23T19:00:00.000Z' } } };
  assert.deepEqual(CoinWalletResponseSchema.parse(response), response);
  assert.equal(CoinWalletResponseSchema.safeParse({ wallet: { ...response.wallet, dailyReward: { ...response.wallet.dailyReward, timeZone: 'UTC' } } }).success, false);
  assert.deepEqual(Object.keys(coinsEndpoints).sort(), ['claim', 'transactions', 'wallet']);
});
