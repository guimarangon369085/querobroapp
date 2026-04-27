export const GOOGLE_FORM_FIELDS = {
  timestamp: 'Carimbo de data/hora',
  name: 'Nome completo',
  phone: 'Telefone',
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

function firstValue(namedValues, key) {
  const value = namedValues?.[key];
  if (!value) return '';
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value).trim();
}

function parseInteger(value) {
  const digits = String(value || '').replace(/[^\d-]/g, '');
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function normalizeFulfillmentMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.includes('retirada') ? 'PICKUP' : 'DELIVERY';
}

function buildIsoDateTime(dateText, timeText) {
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

export function buildQuerobroappPayloadFromNamedValues(namedValues) {
  const scheduledAt = buildIsoDateTime(
    firstValue(namedValues, GOOGLE_FORM_FIELDS.date),
    firstValue(namedValues, GOOGLE_FORM_FIELDS.time)
  );
  const timestamp = firstValue(namedValues, GOOGLE_FORM_FIELDS.timestamp) || new Date().toISOString();
  const phone = firstValue(namedValues, GOOGLE_FORM_FIELDS.phone);

  return {
    version: 1,
    customer: {
      name: firstValue(namedValues, GOOGLE_FORM_FIELDS.name),
      phone,
      address: firstValue(namedValues, GOOGLE_FORM_FIELDS.address),
      deliveryNotes: firstValue(namedValues, GOOGLE_FORM_FIELDS.deliveryNotes)
    },
    fulfillment: {
      mode: normalizeFulfillmentMode(firstValue(namedValues, GOOGLE_FORM_FIELDS.fulfillmentMode)),
      scheduledAt
    },
    flavors: {
      T: parseInteger(firstValue(namedValues, GOOGLE_FORM_FIELDS.traditional)),
      G: parseInteger(firstValue(namedValues, GOOGLE_FORM_FIELDS.goiabada)),
      D: parseInteger(firstValue(namedValues, GOOGLE_FORM_FIELDS.doce)),
      Q: parseInteger(firstValue(namedValues, GOOGLE_FORM_FIELDS.queijo)),
      R: parseInteger(firstValue(namedValues, GOOGLE_FORM_FIELDS.requeijao))
    },
    notes: firstValue(namedValues, GOOGLE_FORM_FIELDS.notes),
    source: {
      channel: 'GOOGLE_FORM',
      externalId: `google-form:${timestamp}:${phone || 'sem-telefone'}`,
      originLabel: 'google-forms.apps-script'
    }
  };
}
