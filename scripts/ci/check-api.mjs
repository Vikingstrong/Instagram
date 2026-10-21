import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { ReadinessResponseSchema } from '../../packages/contracts/dist/index.js';

const origin = 'http://127.0.0.1:4000';
const deadline = Date.now() + 30_000;
let ready = false;

while (Date.now() < deadline) {
  try {
    const response = await fetch(`${origin}/api/v1/readiness`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (response.status === 200) {
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(ReadinessResponseSchema.parse(await response.json()), {
        status: 'ready',
      });
      ready = true;
      break;
    }
    await response.body?.cancel();
  } catch {
    // Startup can take time; the deadline still fails closed on any bad response.
  }
  await setTimeout(1_000);
}
assert.ok(ready, 'Compiled API did not return contract-valid database readiness.');

const ui = await fetch(`${origin}/api/docs/`, {
  signal: AbortSignal.timeout(5_000),
});
assert.equal(ui.status, 200);
assert.match(await ui.text(), /swagger-ui/);

const openapi = await fetch(`${origin}/api/docs/openapi.json`, {
  signal: AbortSignal.timeout(5_000),
});
assert.equal(openapi.status, 200);
const document = await openapi.json();
const responses = document.paths?.['/api/v1/readiness']?.get?.responses;
assert.ok(responses?.['200'] && responses?.['503']);
console.log('Compiled API: real database readiness, Swagger UI and OpenAPI passed.');
