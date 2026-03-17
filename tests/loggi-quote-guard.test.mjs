import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, requestExpectError } from './lib/api-server.mjs';

test('delivery quotes reject dropoff address equal to the pickup origin', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();

  t.after(async () => {
    await shutdown();
  });

  const body = await requestExpectError(apiUrl, '/deliveries/quotes', 400, {
    method: 'POST',
    body: {
      mode: 'DELIVERY',
      scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      customer: {
        name: 'Cliente teste',
        phone: '11999998888',
        address: 'Alameda Jaú 731, São Paulo - SP, Brasil'
      },
      manifest: {
        items: [{ name: 'Tradicional', quantity: 1 }],
        subtotal: 40,
        totalUnits: 7
      }
    }
  });

  assert.match(JSON.stringify(body), /coincide com o ponto de coleta/i);
});
