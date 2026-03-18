const APP_URL = String(process.env.QBAPP_PUBLIC_APP_URL || 'https://querobroa.com.br')
  .trim()
  .replace(/\/+$/, '');
const API_URL = String(process.env.QBAPP_PUBLIC_API_URL || 'https://api.querobroa.com.br')
  .trim()
  .replace(/\/+$/, '');
const OPS_URL = String(process.env.QBAPP_PUBLIC_OPS_URL || 'https://ops.querobroa.com.br')
  .trim()
  .replace(/\/+$/, '');

function buildGoogleFormPreviewPayload() {
  return {
    version: 1,
    customer: {
      name: 'Preview Google Forms QUEROBROAPP',
      phone: '11999998888',
      address: 'Avenida Paulista, 1578 - Bela Vista - Sao Paulo - SP, Brasil',
      deliveryNotes: 'Preview automatico sem criacao de pedido'
    },
    fulfillment: {
      mode: 'DELIVERY',
      scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    },
    flavors: {
      T: 4,
      G: 3,
      D: 0,
      Q: 0,
      R: 0
    },
    notes: 'Preview automatico do deploy publico',
    source: {
      externalId: `deploy-preview-${Date.now()}`
    }
  };
}

async function expectOk(pathname, options = {}) {
  const response = await fetch(`${APP_URL}${pathname}`, {
    redirect: options.redirect || 'follow'
  });
  if (!response.ok) {
    throw new Error(`${pathname} respondeu ${response.status}`);
  }
  return response;
}

async function expectRedirect(url, expectedTarget) {
  const response = await fetch(url, { redirect: 'manual' });
  const location = response.headers.get('location') || '';
  if (response.status < 300 || response.status >= 400) {
    throw new Error(`${url} deveria redirecionar, mas respondeu ${response.status}`);
  }
  if (!location.startsWith(expectedTarget)) {
    throw new Error(`${url} redirecionou para ${location}, esperado prefixo ${expectedTarget}`);
  }
}

async function expectJson(url, init = {}) {
  const response = await fetch(url, init);
  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`${url} nao retornou JSON. Primeiros bytes: ${raw.slice(0, 120)}`);
  }
  return { response, body };
}

async function main() {
  const summary = {
    appUrl: APP_URL,
    apiUrl: API_URL,
    opsUrl: OPS_URL
  };

  const home = await expectOk('/');
  const pedido = await expectOk('/pedido');
  const pedidos = await expectOk('/pedidos');

  const pedidoHtml = await pedido.text();
  if (pedidoHtml.includes('127.0.0.1') || pedidoHtml.includes('localhost')) {
    throw new Error('/pedido publicou referencia local no HTML.');
  }

  await expectRedirect(OPS_URL, `${APP_URL}/pedidos`);

  const { response: healthResponse, body: health } = await expectJson(`${API_URL}/health`);
  if (!healthResponse.ok || health?.status !== 'ok') {
    throw new Error(`API health invalida: ${healthResponse.status} ${JSON.stringify(health)}`);
  }

  const previewPayload = buildGoogleFormPreviewPayload();
  const { response: previewResponse, body: preview } = await expectJson(`${APP_URL}/api/google-form/preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(previewPayload)
  });
  if (!previewResponse.ok) {
    throw new Error(`POST /api/google-form/preview -> ${previewResponse.status} ${JSON.stringify(preview)}`);
  }

  const { response: quoteResponse, body: quote } = await expectJson(`${APP_URL}/api/delivery-quote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      mode: 'DELIVERY',
      scheduledAt: previewPayload.fulfillment.scheduledAt,
      customer: previewPayload.customer,
      manifest: {
        items: [
          { name: 'Tradicional', quantity: 4 },
          { name: 'Goiabada', quantity: 3 }
        ],
        subtotal: preview.order?.subtotal ?? 45,
        totalUnits: 7
      }
    })
  });
  if (!quoteResponse.ok) {
    throw new Error(`POST /api/delivery-quote -> ${quoteResponse.status} ${JSON.stringify(quote)}`);
  }

  summary.homeStatus = home.status;
  summary.pedidoStatus = 200;
  summary.pedidosStatus = 200;
  summary.apiHealth = health.status;
  summary.preview = {
    channel: preview.channel,
    expectedStage: preview.expectedStage,
    fulfillmentMode: preview.fulfillmentMode,
    total: preview.order?.total ?? null,
    deliveryProvider: preview.delivery?.provider ?? null,
    deliverySource: preview.delivery?.source ?? null
  };
  summary.quote = {
    provider: quote.provider ?? null,
    source: quote.source ?? null,
    fee: quote.fee ?? null,
    status: quote.status ?? null
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
