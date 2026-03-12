import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQuerobroappPayloadFromNamedValues, GOOGLE_FORM_FIELDS } from '../scripts/google-form-bridge-payload.mjs';

test('google form bridge payload: aceita data yyyy-mm-dd do Google Forms', () => {
  const payload = buildQuerobroappPayloadFromNamedValues({
    [GOOGLE_FORM_FIELDS.timestamp]: ['2026-03-12T12:00:00.000Z'],
    [GOOGLE_FORM_FIELDS.name]: ['Cliente Teste'],
    [GOOGLE_FORM_FIELDS.phone]: ['31999999999'],
    [GOOGLE_FORM_FIELDS.fulfillmentMode]: ['Entrega'],
    [GOOGLE_FORM_FIELDS.address]: ['Rua A, 10'],
    [GOOGLE_FORM_FIELDS.deliveryNotes]: ['Portao azul'],
    [GOOGLE_FORM_FIELDS.date]: ['2030-03-15'],
    [GOOGLE_FORM_FIELDS.time]: ['14:30'],
    [GOOGLE_FORM_FIELDS.traditional]: ['4'],
    [GOOGLE_FORM_FIELDS.goiabada]: ['3'],
    [GOOGLE_FORM_FIELDS.doce]: ['0'],
    [GOOGLE_FORM_FIELDS.queijo]: ['0'],
    [GOOGLE_FORM_FIELDS.requeijao]: ['0'],
    [GOOGLE_FORM_FIELDS.notes]: ['Sem observacoes']
  });

  assert.equal(payload.customer.name, 'Cliente Teste');
  assert.equal(payload.customer.phone, '31999999999');
  assert.equal(payload.fulfillment.mode, 'DELIVERY');
  assert.equal(payload.flavors.T, 4);
  assert.equal(payload.flavors.G, 3);
  assert.equal(payload.fulfillment.scheduledAt.startsWith('2030-03-15T'), true);
});

test('google form bridge payload: aceita data dd/mm/yyyy e modo retirada', () => {
  const payload = buildQuerobroappPayloadFromNamedValues({
    [GOOGLE_FORM_FIELDS.name]: ['Cliente Retirada'],
    [GOOGLE_FORM_FIELDS.phone]: ['31988887777'],
    [GOOGLE_FORM_FIELDS.fulfillmentMode]: ['Retirada'],
    [GOOGLE_FORM_FIELDS.address]: ['Retirada'],
    [GOOGLE_FORM_FIELDS.date]: ['15/03/2030'],
    [GOOGLE_FORM_FIELDS.time]: ['09:45:00'],
    [GOOGLE_FORM_FIELDS.traditional]: ['7'],
    [GOOGLE_FORM_FIELDS.goiabada]: ['0'],
    [GOOGLE_FORM_FIELDS.doce]: ['0'],
    [GOOGLE_FORM_FIELDS.queijo]: ['0'],
    [GOOGLE_FORM_FIELDS.requeijao]: ['0']
  });

  assert.equal(payload.fulfillment.mode, 'PICKUP');
  assert.equal(payload.flavors.T, 7);
  assert.equal(payload.fulfillment.scheduledAt.startsWith('2030-03-15T'), true);
});
