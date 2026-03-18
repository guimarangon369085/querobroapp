const APP_BASE_URL = 'https://querobroa.com.br';

const FORM_FIELDS = {
  timestamp: 'Carimbo de data/hora',
  name: 'Nome completo',
  phone: 'Telefone com WhatsApp',
  fulfillmentMode: 'Como voce quer receber?',
  address: 'Endereco para entrega',
  deliveryNotes: 'Complemento / referencia',
  date: 'Data do pedido',
  time: 'Horario',
  traditional: 'Quantidade Tradicional (T)',
  goiabada: 'Quantidade Goiabada (G)',
  doce: 'Quantidade Doce de Leite (D)',
  queijo: 'Quantidade Queijo do Serro (Q)',
  requeijao: 'Quantidade Requeijao de Corte (R)',
  notes: 'Observacoes do pedido'
};

function onFormSubmit(e) {
  const namedValues = e && e.namedValues ? e.namedValues : {};
  const payload = buildQuerobroappPayload_(namedValues);
  const url = `${APP_BASE_URL.replace(/\/+$/, '')}/api/google-form`;

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`QUEROBROAPP intake falhou: HTTP ${code} ${response.getContentText()}`);
  }
}

function buildQuerobroappPayload_(namedValues) {
  const dateText = firstValue_(namedValues, FORM_FIELDS.date);
  const timeText = firstValue_(namedValues, FORM_FIELDS.time);
  const scheduledAt = buildIsoDateTime_(dateText, timeText);
  const timestamp = firstValue_(namedValues, FORM_FIELDS.timestamp) || new Date().toISOString();
  const phone = firstValue_(namedValues, FORM_FIELDS.phone);

  return {
    version: 1,
    customer: {
      name: firstValue_(namedValues, FORM_FIELDS.name),
      phone,
      address: firstValue_(namedValues, FORM_FIELDS.address),
      deliveryNotes: firstValue_(namedValues, FORM_FIELDS.deliveryNotes)
    },
    fulfillment: {
      mode: normalizeFulfillmentMode_(firstValue_(namedValues, FORM_FIELDS.fulfillmentMode)),
      scheduledAt
    },
    flavors: {
      T: parseInteger_(firstValue_(namedValues, FORM_FIELDS.traditional)),
      G: parseInteger_(firstValue_(namedValues, FORM_FIELDS.goiabada)),
      D: parseInteger_(firstValue_(namedValues, FORM_FIELDS.doce)),
      Q: parseInteger_(firstValue_(namedValues, FORM_FIELDS.queijo)),
      R: parseInteger_(firstValue_(namedValues, FORM_FIELDS.requeijao))
    },
    notes: firstValue_(namedValues, FORM_FIELDS.notes),
    source: {
      channel: 'GOOGLE_FORM',
      externalId: `google-form:${timestamp}:${phone || 'sem-telefone'}`,
      originLabel: 'google-forms.apps-script'
    }
  };
}

function firstValue_(namedValues, key) {
  const value = namedValues[key];
  if (!value) return '';
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value).trim();
}

function parseInteger_(value) {
  const digits = String(value || '').replace(/[^\d-]/g, '');
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function normalizeFulfillmentMode_(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized.includes('retirada') ? 'PICKUP' : 'DELIVERY';
}

function buildIsoDateTime_(dateText, timeText) {
  const dateParts = String(dateText || '')
    .trim()
    .split(/[\/-]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const timeParts = String(timeText || '')
    .trim()
    .split(':')
    .map((part) => part.trim())
    .filter(Boolean);

  if (dateParts.length !== 3 || timeParts.length < 2) {
    throw new Error('Data do pedido e Horario sao obrigatorios.');
  }

  const yearFirst = dateParts[0].length === 4;
  const day = Number(yearFirst ? dateParts[2] : dateParts[0]);
  const month = Number(dateParts[1]);
  const year = Number(yearFirst ? dateParts[0] : dateParts[2]);
  const hour = Number(timeParts[0]);
  const minute = Number(timeParts[1]);
  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  return local.toISOString();
}
