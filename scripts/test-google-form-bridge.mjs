import { buildQuerobroappPayloadFromNamedValues, GOOGLE_FORM_FIELDS } from './google-form-bridge-payload.mjs';

const APP_URL = String(process.env.QBAPP_GOOGLE_FORM_APP_URL || 'http://127.0.0.1:3000').trim().replace(/\/+$/, '');
const API_URL = String(process.env.QBAPP_GOOGLE_FORM_API_URL || 'http://127.0.0.1:3001')
  .trim()
  .replace(/\/+$/, '');
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

async function request(path, init = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(init.headers || {})
  };
  const response = await fetch(`${API_URL}${path}`, {
    method: init.method || 'GET',
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${path} -> ${response.status}\n${text}`);
  }
  return body;
}

const namedValues = {
  [GOOGLE_FORM_FIELDS.timestamp]: [new Date().toISOString()],
  [GOOGLE_FORM_FIELDS.name]: [`Cliente Google Forms Runner ${suffix}`],
  [GOOGLE_FORM_FIELDS.phone]: ['31988887777'],
  [GOOGLE_FORM_FIELDS.fulfillmentMode]: ['Entrega'],
  [GOOGLE_FORM_FIELDS.address]: ['Rua Runner, 123'],
  [GOOGLE_FORM_FIELDS.deliveryNotes]: ['Portao branco'],
  [GOOGLE_FORM_FIELDS.date]: ['2030-03-15'],
  [GOOGLE_FORM_FIELDS.time]: ['14:30'],
  [GOOGLE_FORM_FIELDS.traditional]: ['4'],
  [GOOGLE_FORM_FIELDS.goiabada]: ['3'],
  [GOOGLE_FORM_FIELDS.doce]: ['0'],
  [GOOGLE_FORM_FIELDS.queijo]: ['0'],
  [GOOGLE_FORM_FIELDS.requeijao]: ['0'],
  [GOOGLE_FORM_FIELDS.notes]: ['Teste real do bridge do Google Forms']
};

const payload = buildQuerobroappPayloadFromNamedValues(namedValues);
const created = { orderId: null, customerId: null };

try {
  const response = await fetch(`${APP_URL}/api/google-form`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`POST /api/google-form -> ${response.status}\n${text}`);
  }

  created.orderId = result.order?.id ?? null;
  created.customerId = result.intake?.customerId ?? null;

  console.log(
    JSON.stringify(
      {
        ok: true,
        orderId: result.order?.id ?? null,
        customerId: result.intake?.customerId ?? null,
        stage: result.intake?.stage ?? null,
        channel: result.intake?.channel ?? null,
        pixProvider: result.intake?.pixCharge?.provider ?? null,
        payable: result.intake?.pixCharge?.payable ?? null
      },
      null,
      2
    )
  );
} finally {
  if (created.orderId) {
    try {
      await request(`/orders/${created.orderId}`, { method: 'DELETE' });
    } catch {}
  }

  if (created.customerId) {
    try {
      await request(`/customers/${created.customerId}`, { method: 'DELETE' });
    } catch {}
  }
}
