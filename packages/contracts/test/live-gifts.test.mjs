import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SendLiveGiftRequestSchema, liveGiftCatalog, liveGiftPrice, isFullscreenGift } from '@instagram/contracts';
test('live gifts: the catalog decides prices; only gifts above 10 coins go full screen', () => {
  assert.deepEqual(liveGiftCatalog.map((gift) => [gift.key, gift.price]), [
    ['rose', 1], ['heart', 3], ['glasses', 5], ['instagram', 10], ['pumpkin', 50], ['cat', 100],
  ]);
  assert.deepEqual(liveGiftCatalog.filter((gift) => isFullscreenGift(gift.key)).map((gift) => gift.key), ['pumpkin', 'cat']);
  assert.equal(liveGiftPrice('instagram'), 10);
  assert.equal(SendLiveGiftRequestSchema.safeParse({ id: randomUUID(), giftKey: 'cat' }).success, true);
  for (const body of [{ id: randomUUID(), giftKey: 'diamond' }, { id: randomUUID(), giftKey: 'rose', price: 0 }, { id: 'x', giftKey: 'rose' }, { id: randomUUID(), giftKey: 'rose', recipientId: randomUUID() }])
    assert.equal(SendLiveGiftRequestSchema.safeParse(body).success, false);
});
