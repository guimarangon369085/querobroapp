const APP_URL = String(process.env.QBAPP_PUBLIC_APP_URL || 'https://querobroa.com.br')
  .trim()
  .replace(/\/+$/, '');
const EXPECTED_FEE = Number.parseFloat(String(process.env.QBAPP_DELIVERY_EXPECTED_FEE || '').trim());
const MAX_DELTA = Number.parseFloat(String(process.env.QBAPP_DELIVERY_MAX_DELTA || '0').trim());

const payload = {
  mode: 'DELIVERY',
  scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  customer: {
    name: 'Preview Frete QUEROBROAPP',
    phone: '11999998888',
    address: 'Avenida Paulista, 1578 - Bela Vista - Sao Paulo - SP, Brasil',
    deliveryNotes: 'Preview automatico sem criar entrega'
  },
  manifest: {
    items: [
      { name: 'Tradicional', quantity: 4 },
      { name: 'Goiabada', quantity: 3 }
    ],
    subtotal: 45,
    totalUnits: 7
  }
};

async function main() {
  const response = await fetch(`${APP_URL}/api/delivery-quote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const raw = await response.text();
  const body = raw ? JSON.parse(raw) : null;
  if (!response.ok) {
    throw new Error(`POST /api/delivery-quote -> ${response.status} ${JSON.stringify(body)}`);
  }

  const result = {
    appUrl: APP_URL,
    provider: body.provider ?? null,
    source: body.source ?? null,
    fee: body.fee ?? null,
    status: body.status ?? null,
    breakdownLabel: body.breakdownLabel ?? null,
    quoteToken: body.quoteToken ?? null
  };

  if (Number.isFinite(EXPECTED_FEE) && EXPECTED_FEE >= 0) {
    const actualFee = Number(body.fee);
    if (!Number.isFinite(actualFee)) {
      throw new Error(`Cotacao sem fee numerico: ${JSON.stringify(body)}`);
    }

    const delta = Math.abs(actualFee - EXPECTED_FEE);
    result.expectedFee = EXPECTED_FEE;
    result.delta = Number(delta.toFixed(2));

    if (Number.isFinite(MAX_DELTA) && MAX_DELTA > 0 && delta > MAX_DELTA) {
      throw new Error(
        `Cotacao fora da tolerancia: fee=${actualFee} esperado=${EXPECTED_FEE} delta=${delta} max=${MAX_DELTA}`
      );
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
