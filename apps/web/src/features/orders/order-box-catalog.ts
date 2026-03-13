import type { Product } from '@querobroapp/shared';

export const ORDER_BOX_UNITS = 7;
export const ORDER_BOX_PRICE_CUSTOM = 52;
export const ORDER_BOX_PRICE_TRADITIONAL = 40;
export const ORDER_BOX_PRICE_MIXED_GOIABADA = 45;
export const ORDER_BOX_PRICE_MIXED_OTHER = 47;
export const ORDER_BOX_PRICE_GOIABADA = 50;

export const ORDER_MISTA_SHORTCUT_CODES = ['G', 'D', 'Q', 'R'] as const;
export const ORDER_FLAVOR_CODES = ['T', 'G', 'D', 'Q', 'R'] as const;

export type OrderMistaShortcutCode = (typeof ORDER_MISTA_SHORTCUT_CODES)[number];
export type OrderFlavorCode = (typeof ORDER_FLAVOR_CODES)[number];

export const ORDER_FLAVOR_OFFICIAL_BOX_NAME_BY_CODE: Record<OrderFlavorCode, string> = {
  T: 'Caixa Tradicional (T)',
  G: 'Caixa de Goiabada (G)',
  D: 'Caixa de Doce de Leite (D)',
  Q: 'Caixa de Queijo (Q)',
  R: 'Caixa de Requeijão de Corte (R)'
};

export const ORDER_MISTA_OFFICIAL_BOX_NAME_BY_CODE: Record<OrderMistaShortcutCode, string> = {
  G: 'Caixa Mista de Goiabada (MG)',
  D: 'Caixa Mista de Doce de Leite (MD)',
  Q: 'Caixa Mista de Queijo (MQ)',
  R: 'Caixa Mista de Requeijão de Corte (MR)'
};

export const ORDER_FLAVOR_CARD_IMAGE_BY_CODE: Record<OrderFlavorCode, string> = {
  T: '/querobroa-brand/stack.jpg',
  G: '/querobroa-brand/goiabada-pink.jpg',
  D: '/querobroa-brand/doce-pink.jpg',
  Q: '/querobroa-brand/queijo-brown.jpg',
  R: '/querobroa-brand/yellow-composition.jpg'
};

export const ORDER_BOX_CATALOG = {
  T: {
    label: 'Tradicional',
    codeLabel: 'T',
    detail: '1 caixa = 7 broas tradicionais',
    note: 'Receita classica da casa',
    image: '/querobroa-brand/stack.jpg',
    accentClassName:
      'border-[rgba(176,120,66,0.16)] bg-[linear-gradient(165deg,rgba(255,249,241,0.98),rgba(247,232,213,0.9))]',
    units: { T: 7, G: 0, D: 0, Q: 0, R: 0 },
    priceEstimate: 40
  },
  G: {
    label: 'Goiabada',
    codeLabel: 'G',
    detail: '1 caixa = 7 broas de goiabada',
    note: 'Mais pedida',
    image: '/querobroa-brand/goiabada-pink.jpg',
    accentClassName:
      'border-[rgba(190,84,108,0.18)] bg-[linear-gradient(165deg,rgba(255,246,248,0.98),rgba(249,228,234,0.9))]',
    units: { T: 0, G: 7, D: 0, Q: 0, R: 0 },
    priceEstimate: 50
  },
  D: {
    label: 'Doce de Leite',
    codeLabel: 'D',
    detail: '1 caixa = 7 broas de doce de leite',
    note: 'Mais cremosa',
    image: '/querobroa-brand/doce-pink.jpg',
    accentClassName:
      'border-[rgba(172,116,61,0.16)] bg-[linear-gradient(165deg,rgba(255,248,241,0.98),rgba(247,236,224,0.9))]',
    units: { T: 0, G: 0, D: 7, Q: 0, R: 0 },
    priceEstimate: 52
  },
  Q: {
    label: 'Queijo do Serro',
    codeLabel: 'Q',
    detail: '1 caixa = 7 broas de queijo',
    note: 'Mais marcante',
    image: '/querobroa-brand/queijo-brown.jpg',
    accentClassName:
      'border-[rgba(110,95,71,0.18)] bg-[linear-gradient(165deg,rgba(251,247,242,0.98),rgba(240,230,218,0.92))]',
    units: { T: 0, G: 0, D: 0, Q: 7, R: 0 },
    priceEstimate: 52
  },
  R: {
    label: 'Requeijao de Corte',
    codeLabel: 'R',
    detail: '1 caixa = 7 broas de requeijao',
    note: 'Mais suave',
    image: '/querobroa-brand/yellow-composition.jpg',
    accentClassName:
      'border-[rgba(150,122,83,0.18)] bg-[linear-gradient(165deg,rgba(255,250,242,0.98),rgba(247,238,223,0.92))]',
    units: { T: 0, G: 0, D: 0, Q: 0, R: 7 },
    priceEstimate: 52
  },
  MG: {
    label: 'Mista Goiabada',
    codeLabel: 'MG',
    detail: '1 caixa = 4 tradicionais + 3 goiabada',
    note: 'A mista mais classica',
    image: '/querobroa-brand/goiabada-pink.jpg',
    accentClassName:
      'border-[rgba(190,84,108,0.18)] bg-[linear-gradient(165deg,rgba(255,247,243,0.98),rgba(251,232,228,0.92))]',
    units: { T: 4, G: 3, D: 0, Q: 0, R: 0 },
    priceEstimate: 45
  },
  MD: {
    label: 'Mista Doce de Leite',
    codeLabel: 'MD',
    detail: '1 caixa = 4 tradicionais + 3 doce de leite',
    note: 'Equilibrio entre classica e cremosa',
    image: '/querobroa-brand/doce-pink.jpg',
    accentClassName:
      'border-[rgba(172,116,61,0.16)] bg-[linear-gradient(165deg,rgba(255,248,243,0.98),rgba(247,235,225,0.92))]',
    units: { T: 4, G: 0, D: 3, Q: 0, R: 0 },
    priceEstimate: 47
  },
  MQ: {
    label: 'Mista Queijo',
    codeLabel: 'MQ',
    detail: '1 caixa = 4 tradicionais + 3 queijo',
    note: 'Mais intensa',
    image: '/querobroa-brand/queijo-brown.jpg',
    accentClassName:
      'border-[rgba(110,95,71,0.18)] bg-[linear-gradient(165deg,rgba(252,248,244,0.98),rgba(242,233,223,0.92))]',
    units: { T: 4, G: 0, D: 0, Q: 3, R: 0 },
    priceEstimate: 47
  },
  MR: {
    label: 'Mista Requeijao',
    codeLabel: 'MR',
    detail: '1 caixa = 4 tradicionais + 3 requeijao',
    note: 'Mineira e mais leve',
    image: '/querobroa-brand/half-broa.jpg',
    accentClassName:
      'border-[rgba(150,122,83,0.18)] bg-[linear-gradient(165deg,rgba(255,250,243,0.98),rgba(245,236,223,0.92))]',
    units: { T: 4, G: 0, D: 0, Q: 0, R: 3 },
    priceEstimate: 47
  }
} as const;

export type OrderBoxCode = keyof typeof ORDER_BOX_CATALOG;

export const ORDER_BRAND_GALLERY_IMAGES = [
  {
    src: '/querobroa-brand/fornada.jpg',
    alt: 'Fornada de broas pronta',
    className: 'left-0 top-6 h-[220px] w-[180px] sm:h-[250px] sm:w-[210px]',
    transform: 'translate3d(0px, 0px, 0px) rotate(-8deg)'
  },
  {
    src: '/querobroa-brand/yellow-composition.jpg',
    alt: 'Composicao com broas e queijo',
    className: 'right-3 top-0 h-[200px] w-[150px] sm:h-[220px] sm:w-[170px]',
    transform: 'translate3d(0px, -10px, 20px) rotate(9deg)'
  },
  {
    src: '/querobroa-brand/goiabada-pink.jpg',
    alt: 'Broa de goiabada',
    className: 'right-0 top-[190px] h-[160px] w-[130px] sm:top-[210px] sm:h-[180px] sm:w-[145px]',
    transform: 'translate3d(0px, 0px, 40px) rotate(6deg)'
  },
  {
    src: '/querobroa-brand/green-composition.jpg',
    alt: 'Pilha de broas',
    className: 'left-[130px] top-[220px] h-[190px] w-[150px] sm:left-[170px] sm:top-[240px] sm:h-[210px] sm:w-[170px]',
    transform: 'translate3d(0px, 0px, 30px) rotate(-5deg)'
  }
] as const;

export function compactOrderProductName(name: string) {
  const compacted = name.replace(/^Broa\s+/i, '').trim();
  return compacted
    .replace(/requeij[aã]o de corte/gi, 'Requeijão de Corte')
    .replace(/doce de leite/gi, 'Doce de Leite');
}

export function normalizeOrderFlavorName(value?: string | null) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function resolveOrderFlavorCodeFromName(value?: string | null): OrderFlavorCode | null {
  const normalized = normalizeOrderFlavorName(value);
  if (!normalized) return null;
  if (normalized.includes('tradicional')) return 'T';
  if (normalized.includes('goiabada')) return 'G';
  if (normalized.includes('doce')) return 'D';
  if (normalized.includes('queijo') && !normalized.includes('requeij')) return 'Q';
  if (normalized.includes('requeij')) return 'R';
  return null;
}

export function resolveOrderCardImage(productName?: string | null) {
  const code = resolveOrderFlavorCodeFromName(productName);
  return code ? ORDER_FLAVOR_CARD_IMAGE_BY_CODE[code] : '/querobroa-brand/green-composition.jpg';
}

export function deriveFlavorUnitsFromBoxCounts(boxCounts: Record<OrderBoxCode, number>) {
  const result: Record<OrderFlavorCode, number> = { T: 0, G: 0, D: 0, Q: 0, R: 0 };
  for (const code of Object.keys(ORDER_BOX_CATALOG) as OrderBoxCode[]) {
    const count = boxCounts[code] || 0;
    if (count <= 0) continue;
    const unitMap = ORDER_BOX_CATALOG[code].units;
    result.T += unitMap.T * count;
    result.G += unitMap.G * count;
    result.D += unitMap.D * count;
    result.Q += unitMap.Q * count;
    result.R += unitMap.R * count;
  }
  return result;
}

export function sumOrderFlavorCounts(counts: Record<OrderFlavorCode, number>) {
  return ORDER_FLAVOR_CODES.reduce((sum, code) => sum + Math.max(Math.floor(counts[code] || 0), 0), 0);
}

function toMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateOrderSubtotalFromFlavorSummary(params: {
  totalUnits: number;
  flavorCounts: Record<OrderFlavorCode, number>;
}) {
  const { totalUnits, flavorCounts } = params;
  if (totalUnits <= 0) return 0;

  const fullBoxes = Math.floor(totalUnits / ORDER_BOX_UNITS);
  const openUnits = totalUnits % ORDER_BOX_UNITS;
  if (fullBoxes <= 0) {
    return toMoney((ORDER_BOX_PRICE_CUSTOM / ORDER_BOX_UNITS) * openUnits);
  }

  const countTraditional = Math.max(Math.floor(flavorCounts.T || 0), 0);
  const countGoiabada = Math.max(Math.floor(flavorCounts.G || 0), 0);
  const countDoce = Math.max(Math.floor(flavorCounts.D || 0), 0);
  const countQueijo = Math.max(Math.floor(flavorCounts.Q || 0), 0);
  const countRequeijao = Math.max(Math.floor(flavorCounts.R || 0), 0);

  const goiabadaTriplets = Math.floor(countGoiabada / 3);
  const otherTriplets =
    Math.floor(countDoce / 3) + Math.floor(countQueijo / 3) + Math.floor(countRequeijao / 3);

  const discountTraditional = ORDER_BOX_PRICE_CUSTOM - ORDER_BOX_PRICE_TRADITIONAL;
  const discountMixedGoiabada = ORDER_BOX_PRICE_CUSTOM - ORDER_BOX_PRICE_MIXED_GOIABADA;
  const discountMixedOther = ORDER_BOX_PRICE_CUSTOM - ORDER_BOX_PRICE_MIXED_OTHER;
  const discountGoiabada = ORDER_BOX_PRICE_CUSTOM - ORDER_BOX_PRICE_GOIABADA;

  let bestDiscount = 0;
  const maxMixedGoiabada = Math.min(goiabadaTriplets, Math.floor(countTraditional / 4), fullBoxes);

  for (let mixedGoiabada = 0; mixedGoiabada <= maxMixedGoiabada; mixedGoiabada += 1) {
    const remainingTraditionalAfterMixedGoiabada = countTraditional - mixedGoiabada * 4;
    const maxMixedOther = Math.min(
      otherTriplets,
      Math.floor(remainingTraditionalAfterMixedGoiabada / 4),
      fullBoxes - mixedGoiabada
    );

    for (let mixedOther = 0; mixedOther <= maxMixedOther; mixedOther += 1) {
      const remainingTraditional = remainingTraditionalAfterMixedGoiabada - mixedOther * 4;
      const maxTraditionalBoxes = Math.min(
        Math.floor(remainingTraditional / ORDER_BOX_UNITS),
        fullBoxes - mixedGoiabada - mixedOther
      );

      for (let traditionalBoxes = 0; traditionalBoxes <= maxTraditionalBoxes; traditionalBoxes += 1) {
        const usedBoxes = mixedGoiabada + mixedOther + traditionalBoxes;
        const remainingBoxSlots = fullBoxes - usedBoxes;
        const remainingGoiabada = countGoiabada - mixedGoiabada * 3;
        const goiabadaBoxes = Math.min(
          Math.floor(remainingGoiabada / ORDER_BOX_UNITS),
          remainingBoxSlots
        );

        const discount =
          mixedGoiabada * discountMixedGoiabada +
          mixedOther * discountMixedOther +
          traditionalBoxes * discountTraditional +
          goiabadaBoxes * discountGoiabada;

        if (discount > bestDiscount) {
          bestDiscount = discount;
        }
      }
    }
  }

  const fullBoxesSubtotal = fullBoxes * ORDER_BOX_PRICE_CUSTOM - bestDiscount;
  const openSubtotal =
    openUnits > 0 ? toMoney((ORDER_BOX_PRICE_CUSTOM / ORDER_BOX_UNITS) * openUnits) : 0;

  return toMoney(fullBoxesSubtotal + openSubtotal);
}

export function buildOrderFlavorSummaryFromItems(
  items: Array<{ productId: number; quantity: number }>,
  productMap: Map<number, Product>
) {
  const flavorCounts: Record<OrderFlavorCode, number> = {
    T: 0,
    G: 0,
    D: 0,
    Q: 0,
    R: 0
  };
  let totalUnits = 0;

  for (const item of items) {
    const quantity = Math.max(Math.floor(item.quantity || 0), 0);
    if (quantity <= 0) continue;
    totalUnits += quantity;
    const flavorCode = resolveOrderFlavorCodeFromName(productMap.get(item.productId)?.name);
    if (!flavorCode) continue;
    flavorCounts[flavorCode] += quantity;
  }

  return { totalUnits, flavorCounts };
}

export function formatOrderFlavorComposition(units: Record<OrderFlavorCode, number>) {
  const active = ORDER_FLAVOR_CODES.map((code) => ({ code, quantity: units[code] }))
    .filter((entry) => entry.quantity > 0)
    .map((entry) => `${entry.quantity} ${ORDER_BOX_CATALOG[entry.code].label}`);
  return active.length ? active.join(' • ') : 'Nenhuma broa calculada ainda';
}
