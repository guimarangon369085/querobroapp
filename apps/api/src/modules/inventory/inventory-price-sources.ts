const DEFAULT_TIMEOUT_MS = 15_000;

export type InventoryPriceSourceDefinition = {
  canonicalName: string;
  sourceName: string;
  url: string;
  sourcePackSize: number;
  fallbackPrice: number;
  historicalSamplePrices?: number[];
  strategy: 'paodeacucar' | 'fornecedornet' | 'trela' | 'superabc' | 'manual';
};

export const INVENTORY_PRICE_SOURCE_DEFINITIONS: InventoryPriceSourceDefinition[] = [
  {
    canonicalName: 'FARINHA DE TRIGO',
    sourceName: 'Pao de Acucar',
    url: 'https://www.paodeacucar.com/produto/23692/farinha-de-trigo-tipo-1-tradicional-qualita-pacote-1kg',
    sourcePackSize: 1000,
    fallbackPrice: 6.49,
    historicalSamplePrices: [6.19],
    strategy: 'paodeacucar'
  },
  {
    canonicalName: 'FUBÁ DE CANJICA',
    sourceName: 'Super ABC',
    url: 'https://superabconline.com.br/p/d/2593871/fuba-canjica-rocinha-1kg/p?srsltid=AfmBOopm2tuTDIIbMkyeDJ9wrv1qP3q9xfNLKuw60mxXeRSZEhVicbEnKEA',
    sourcePackSize: 1000,
    fallbackPrice: 11.99,
    historicalSamplePrices: [6],
    strategy: 'superabc'
  },
  {
    canonicalName: 'AÇÚCAR',
    sourceName: 'Pao de Acucar',
    url: 'https://www.paodeacucar.com/produto/74215/acucar-refinado-uniao-pacote-1kg',
    sourcePackSize: 1000,
    fallbackPrice: 4.59,
    historicalSamplePrices: [5.69],
    strategy: 'paodeacucar'
  },
  {
    canonicalName: 'MANTEIGA',
    sourceName: 'Pao de Acucar',
    url: 'https://www.paodeacucar.com/produto/53023/manteiga-com-sal-batavo-200g',
    sourcePackSize: 200,
    fallbackPrice: 12.79,
    strategy: 'paodeacucar'
  },
  {
    canonicalName: 'LEITE',
    sourceName: 'Pao de Acucar',
    url: 'https://www.paodeacucar.com/produto/164887/leite-uht-integral-qualita-caixa-com-tampa-1l',
    sourcePackSize: 1000,
    fallbackPrice: 5.49,
    historicalSamplePrices: [3.49, 4.19],
    strategy: 'paodeacucar'
  },
  {
    canonicalName: 'OVOS',
    sourceName: 'Pao de Acucar',
    url: 'https://www.paodeacucar.com/produto/1636359/ovos-vermelhos-qualita-livre-de-gaiola-bandeja-20-unidades',
    sourcePackSize: 20,
    fallbackPrice: 23.9,
    strategy: 'paodeacucar'
  },
  {
    canonicalName: 'GOIABADA',
    sourceName: 'Pao de Acucar',
    url: 'https://www.paodeacucar.com/produto/93418/goiabada-corte-qualita-pacote-300g',
    sourcePackSize: 300,
    fallbackPrice: 5.99,
    strategy: 'paodeacucar'
  },
  {
    canonicalName: 'DOCE DE LEITE',
    sourceName: 'Pao de Acucar',
    url: 'https://www.paodeacucar.com/produto/354500/doce-de-leite-tradicional-portao-do-cambui-pacote-200g',
    sourcePackSize: 200,
    fallbackPrice: 20.99,
    strategy: 'paodeacucar'
  },
  {
    canonicalName: 'QUEIJO DO SERRO',
    sourceName: 'Pao de Acucar',
    url: 'https://www.paodeacucar.com/produto/443109/queijo-minas-meia-cura-do-serro-500g',
    sourcePackSize: 500,
    fallbackPrice: 46.95,
    strategy: 'paodeacucar'
  },
  {
    canonicalName: 'REQUEIJÃO DE CORTE',
    sourceName: 'Trela',
    url: 'https://trela.com.br/produto/requeijao-com-raspas-de-queijo-240g-5844?srsltid=AfmBOopt-HWdbUiyu1vwm-0jNhU5Cn_oVVCiqDtq_4YXP81S88P3JDOg',
    sourcePackSize: 240,
    fallbackPrice: 30.9,
    strategy: 'trela'
  },
  {
    canonicalName: 'SACOLA',
    sourceName: 'FornecedorNet',
    url: 'https://www.fornecedornet.com.br/papel-e-papelao/papel/sacolas-de-papel/sacola-kraft-natural-23-5x17x28cm-pacote-com-10-unidades',
    sourcePackSize: 10,
    fallbackPrice: 17.88,
    strategy: 'fornecedornet'
  },
  {
    canonicalName: 'CAIXA DE PLÁSTICO',
    sourceName: 'FornecedorNet',
    url: 'https://www.fornecedornet.com.br/ga-20-rocambole-alto-galvanotek-caixa-100-unidades?search=rocambole&description=true',
    sourcePackSize: 100,
    fallbackPrice: 86.65,
    strategy: 'fornecedornet'
  },
  {
    canonicalName: 'PAPEL MANTEIGA',
    sourceName: 'Pao de Acucar',
    url: 'https://www.paodeacucar.com/produto/108699/papel-manteiga-qualita-30cm-x-7,5m',
    sourcePackSize: 750,
    fallbackPrice: 7.87,
    historicalSamplePrices: [6.69, 7.09],
    strategy: 'paodeacucar'
  }
];

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseDotDecimal(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}

function parseMoneyBR(value: string) {
  const normalized = value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^\d,.-]/g, '')
    .trim()
    .replace(/\./g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}

function extractPaodeAcucarPrice(html: string) {
  const jsonLdMatch = html.match(/"priceCurrency"\s*:\s*"BRL"[\s\S]*?"price"\s*:\s*"([0-9.]+)"/i);
  if (jsonLdMatch?.[1]) {
    return parseDotDecimal(jsonLdMatch[1]);
  }

  const ariaLabelMatch = html.match(/aria-label="Preço\s*R\$\s*([0-9.,]+)"/i);
  if (ariaLabelMatch?.[1]) {
    return parseMoneyBR(ariaLabelMatch[1]);
  }

  const genericMatch = html.match(/R\$\s*([0-9]+(?:[.,][0-9]{2})?)/i);
  if (genericMatch?.[1]) {
    return parseMoneyBR(genericMatch[1]);
  }

  return null;
}

function extractFornecedorNetPrice(html: string) {
  const blockMatch = html.match(/<ul class="list-unstyled price">([\s\S]{0,600}?)<\/ul>/i);
  const target = blockMatch?.[1] || html;
  const liveMatch =
    target.match(/price-old-live">\s*R\$\s*([0-9.,]+)\s*</i) ||
    target.match(/price-new">\s*R\$\s*([0-9.,]+)\s*</i) ||
    target.match(/<h2>\s*<span[^>]*>\s*R\$\s*([0-9.,]+)\s*<\/span>/i);
  if (liveMatch?.[1]) {
    return parseMoneyBR(liveMatch[1]);
  }
  return null;
}

function extractSuperAbcPrice(html: string) {
  const primaryMatch =
    html.match(/R\$\s*([0-9]+(?:,[0-9]{2})?)\s*un/i) ||
    html.match(/Preço por quilo:\s*R\$\s*([0-9]+(?:,[0-9]{2})?)/i);
  if (primaryMatch?.[1]) {
    return parseMoneyBR(primaryMatch[1]);
  }
  return null;
}

function extractTrelaPrice(html: string) {
  const saleMatch = html.match(/data-line-through="true">\s*R\$\s*([0-9.,]+)\s*<\/p>\s*<p[^>]*>\s*R\$\s*([0-9.,]+)\s*</i);
  if (saleMatch?.[2]) {
    return parseMoneyBR(saleMatch[2]);
  }

  const allMatches = [...html.matchAll(/R\$\s*([0-9]+(?:\.[0-9]{3})*,[0-9]{2})/g)]
    .map((entry) => parseMoneyBR(entry[1] || ''))
    .filter((value): value is number => value != null);
  if (allMatches.length === 0) return null;
  if (allMatches.length === 1) return allMatches[0];
  return Math.min(...allMatches);
}

async function fetchHtml(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

export type InventoryPriceFetchResult = {
  sourceName: string;
  sourceUrl: string;
  sourcePackSize: number;
  price: number;
  status: 'LIVE' | 'FALLBACK';
  message: string;
};

export async function fetchInventorySourcePrice(
  definition: InventoryPriceSourceDefinition
): Promise<InventoryPriceFetchResult> {
  if (definition.strategy === 'manual') {
    return {
      sourceName: definition.sourceName,
      sourceUrl: definition.url,
      sourcePackSize: definition.sourcePackSize,
      price: definition.fallbackPrice,
      status: 'FALLBACK',
      message: 'Fonte antiga bloqueada; mantido valor manual da planilha.'
    };
  }

  try {
    const html = await fetchHtml(definition.url);
    const extracted =
      definition.strategy === 'paodeacucar'
        ? extractPaodeAcucarPrice(html)
        : definition.strategy === 'superabc'
          ? extractSuperAbcPrice(html)
        : definition.strategy === 'fornecedornet'
          ? extractFornecedorNetPrice(html)
          : extractTrelaPrice(html);

    if (extracted == null || extracted <= 0) {
      throw new Error('Preco nao encontrado no HTML da pagina.');
    }

    return {
      sourceName: definition.sourceName,
      sourceUrl: definition.url,
      sourcePackSize: definition.sourcePackSize,
      price: extracted,
      status: 'LIVE',
      message: 'Preco atualizado a partir da pagina de origem.'
    };
  } catch (error) {
    return {
      sourceName: definition.sourceName,
      sourceUrl: definition.url,
      sourcePackSize: definition.sourcePackSize,
      price: definition.fallbackPrice,
      status: 'FALLBACK',
      message: error instanceof Error ? error.message : 'Falha ao consultar a fonte online.'
    };
  }
}
