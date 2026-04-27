import {
  buildCompanionProductMakerLine,
  buildCompanionProductName,
  moneyFromMinorUnits,
  moneyToMinorUnits,
  resolveCompanionProductCanonicalImageUrl,
  resolveCompanionProductProfile,
  type Product
} from '@querobroapp/shared';

export type OrderCardArt =
  | {
      mode: 'single';
      src: string;
      objectPosition?: string;
    }
  | {
      mode: 'split';
      leftSrc: string;
      rightSrc: string;
      leftObjectPosition?: string;
      rightObjectPosition?: string;
    }
  | {
      mode: 'columns';
      columns: ReadonlyArray<{
        src: string;
        objectPosition?: string;
      }>;
    }
  | {
      mode: 'weighted-columns';
      columns: ReadonlyArray<{
        src: string;
        objectPosition?: string;
        span: number;
      }>;
    };

export type RuntimeOrderFlavorKind = 'TRADITIONAL' | 'GOIABADA' | 'PREMIUM';

export type RuntimeOrderFlavorProduct = {
  id: number;
  key: string;
  name: string;
  category: string | null;
  active: boolean;
  label: string;
  kind: RuntimeOrderFlavorKind;
  legacyCode: OrderFlavorCode | null;
  imageUrl: string | null;
};

export type RuntimeOrderCompanionProduct = {
  id: number;
  key: string;
  name: string;
  category: string | null;
  active: boolean;
  temporarilyOutOfStock: boolean;
  label: string;
  displayTitle: string;
  displayFlavor: string | null;
  displayMakerLine: string | null;
  imageUrl: string | null;
  price: number;
  unit: string | null;
  measureLabel: string | null;
  drawerNote: string | null;
};

export type RuntimeOrderBoxEntry = {
  key: string;
  kind: 'SINGLE' | 'MIXED';
  label: string;
  detail: string;
  art: OrderCardArt;
  drawerArt?: OrderCardArt;
  accentClassName: string;
  priceEstimate: number;
  unitsByProductId: Record<number, number>;
  productId: number;
  legacyCode: OrderBoxCode | null;
};

export type RuntimeOrderCatalog = {
  flavorProducts: RuntimeOrderFlavorProduct[];
  flavorProductById: Map<number, RuntimeOrderFlavorProduct>;
  flavorProductByLegacyCode: Partial<Record<OrderFlavorCode, RuntimeOrderFlavorProduct>>;
  traditionalFlavor: RuntimeOrderFlavorProduct | null;
  companionProducts: RuntimeOrderCompanionProduct[];
  companionProductById: Map<number, RuntimeOrderCompanionProduct>;
  companionProductByKey: Map<string, RuntimeOrderCompanionProduct>;
  boxEntries: RuntimeOrderBoxEntry[];
  boxEntryByKey: Map<string, RuntimeOrderBoxEntry>;
  boxKeyByLegacyCode: Partial<Record<OrderBoxCode, string>>;
};

export const ORDER_BOX_UNITS = 7;
export const ORDER_BOX_PRICE_CUSTOM = 52;
export const ORDER_BOX_PRICE_TRADITIONAL = 40;
export const ORDER_BOX_PRICE_MIXED_GOIABADA = 45;
export const ORDER_BOX_PRICE_MIXED_OTHER = 47;
export const ORDER_BOX_PRICE_GOIABADA = 50;

const ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS = moneyToMinorUnits(ORDER_BOX_PRICE_CUSTOM);
const ORDER_BOX_PRICE_TRADITIONAL_MINOR_UNITS = moneyToMinorUnits(ORDER_BOX_PRICE_TRADITIONAL);
const ORDER_BOX_PRICE_MIXED_GOIABADA_MINOR_UNITS = moneyToMinorUnits(ORDER_BOX_PRICE_MIXED_GOIABADA);
const ORDER_BOX_PRICE_MIXED_OTHER_MINOR_UNITS = moneyToMinorUnits(ORDER_BOX_PRICE_MIXED_OTHER);
const ORDER_BOX_PRICE_GOIABADA_MINOR_UNITS = moneyToMinorUnits(ORDER_BOX_PRICE_GOIABADA);

export const ORDER_MISTA_SHORTCUT_CODES = ['G', 'D', 'Q', 'R', 'RJ'] as const;
export const ORDER_FLAVOR_CODES = ['T', 'G', 'D', 'Q', 'R', 'RJ'] as const;

export type OrderMistaShortcutCode = (typeof ORDER_MISTA_SHORTCUT_CODES)[number];
export type OrderFlavorCode = (typeof ORDER_FLAVOR_CODES)[number];
export const ORDER_BOX_CATALOG_CONTENT_ID_PREFIX = 'QUEROBROA-' as const;
export const ORDER_CUSTOM_BOX_CATALOG_CODE = 'S' as const;
export type OrderCatalogPrefillCode = OrderBoxCode | typeof ORDER_CUSTOM_BOX_CATALOG_CODE;

export const ORDER_FLAVOR_OFFICIAL_BOX_NAME_BY_CODE: Record<OrderFlavorCode, string> = {
  T: 'Caixa Tradicional',
  G: 'Caixa de Goiabada',
  D: 'Caixa de Doce de Leite',
  Q: 'Caixa de Queijo',
  R: 'Caixa de Requeijão de Corte',
  RJ: 'Caixa Romeu e Julieta'
};

export const ORDER_MISTA_OFFICIAL_BOX_NAME_BY_CODE: Record<OrderMistaShortcutCode, string> = {
  G: 'Caixa Mista de Goiabada',
  D: 'Caixa Mista de Doce de Leite',
  Q: 'Caixa Mista de Queijo do Serro',
  R: 'Caixa Mista de Requeijão de Corte',
  RJ: 'Caixa Mista de Romeu e Julieta'
};

const ORDER_CARDAPIO_IMAGE_PATHS = {
  traditional: '/querobroa-brand/cardapio/tradicional.jpg',
  goiabada: '/querobroa-brand/cardapio/goiabada.jpg',
  doceDeLeite: '/querobroa-brand/cardapio/doce-de-leite.jpg',
  queijoDoSerro: '/querobroa-brand/cardapio/queijo-do-serro-camadas.jpg',
  requeijaoDeCorte: '/querobroa-brand/cardapio/requeijao-de-corte.jpg',
  romeuEJulieta: '/querobroa-brand/cardapio/romeu-e-julieta.jpg?v=20260422-rj3',
  mistaGoiabada: '/querobroa-brand/cardapio/mista-goiabada.jpg',
  mistaDoceDeLeite: '/querobroa-brand/cardapio/mista-doce-de-leite.jpg',
  mistaQueijoDoSerro: '/querobroa-brand/cardapio/mista-queijo-do-serro.jpg',
  mistaRequeijaoDeCorte: '/querobroa-brand/cardapio/mista-requeijao-de-corte.jpg',
  mistaRomeuEJulieta: '/querobroa-brand/cardapio/mista-romeu-e-julieta.jpg',
  sabores: '/querobroa-brand/cardapio/sabores-caixa.jpg?v=20260422-rj3'
} as const;

export const ORDER_SABORES_REFERENCE_IMAGE = ORDER_CARDAPIO_IMAGE_PATHS.sabores;

export const ORDER_FLAVOR_CARD_ART_BY_CODE: Record<
  OrderFlavorCode,
  Extract<OrderCardArt, { mode: 'single' }>
> = {
  T: {
    mode: 'single',
    src: ORDER_CARDAPIO_IMAGE_PATHS.traditional,
    objectPosition: 'center center'
  },
  G: {
    mode: 'single',
    src: ORDER_CARDAPIO_IMAGE_PATHS.goiabada,
    objectPosition: 'center center'
  },
  D: {
    mode: 'single',
    src: ORDER_CARDAPIO_IMAGE_PATHS.doceDeLeite,
    objectPosition: 'center center'
  },
  Q: {
    mode: 'single',
    src: ORDER_CARDAPIO_IMAGE_PATHS.queijoDoSerro,
    objectPosition: 'center center'
  },
  R: {
    mode: 'single',
    src: ORDER_CARDAPIO_IMAGE_PATHS.requeijaoDeCorte,
    objectPosition: 'center center'
  },
  RJ: {
    mode: 'single',
    src: ORDER_CARDAPIO_IMAGE_PATHS.mistaRomeuEJulieta,
    objectPosition: 'center center'
  }
};

export const ORDER_SABORES_CARD_ART: Extract<OrderCardArt, { mode: 'columns' }> = {
  mode: 'columns',
  columns: ORDER_FLAVOR_CODES.map((code) => {
    const art = ORDER_FLAVOR_CARD_ART_BY_CODE[code];
    return art.mode === 'single'
      ? {
          src: art.src,
          objectPosition: art.objectPosition
        }
      : {
          src: ORDER_SABORES_REFERENCE_IMAGE
        };
  })
};

export const ORDER_GENERIC_CARD_ART: OrderCardArt = ORDER_SABORES_CARD_ART;

const ORDER_MISTA_CARD_ART_BY_CODE: Record<
  OrderMistaShortcutCode,
  Extract<OrderCardArt, { mode: 'split' }>
> = {
  G: {
    mode: 'split',
    leftSrc: ORDER_CARDAPIO_IMAGE_PATHS.traditional,
    rightSrc: ORDER_CARDAPIO_IMAGE_PATHS.goiabada,
    leftObjectPosition: 'center center',
    rightObjectPosition: 'center center'
  },
  D: {
    mode: 'split',
    leftSrc: ORDER_CARDAPIO_IMAGE_PATHS.traditional,
    rightSrc: ORDER_CARDAPIO_IMAGE_PATHS.doceDeLeite,
    leftObjectPosition: 'center center',
    rightObjectPosition: 'center center'
  },
  Q: {
    mode: 'split',
    leftSrc: ORDER_CARDAPIO_IMAGE_PATHS.traditional,
    rightSrc: ORDER_CARDAPIO_IMAGE_PATHS.queijoDoSerro,
    leftObjectPosition: 'center center',
    rightObjectPosition: 'center center'
  },
  R: {
    mode: 'split',
    leftSrc: ORDER_CARDAPIO_IMAGE_PATHS.traditional,
    rightSrc: ORDER_CARDAPIO_IMAGE_PATHS.requeijaoDeCorte,
    leftObjectPosition: 'center center',
    rightObjectPosition: 'center center'
  },
  RJ: {
    mode: 'split',
    leftSrc: ORDER_CARDAPIO_IMAGE_PATHS.traditional,
    rightSrc: ORDER_CARDAPIO_IMAGE_PATHS.romeuEJulieta,
    leftObjectPosition: 'center center',
    rightObjectPosition: 'center center'
  }
};

const ORDER_MISTA_DRAWER_ART_BY_CODE: Record<
  OrderMistaShortcutCode,
  Extract<OrderCardArt, { mode: 'single' }>
> = {
  G: {
    mode: 'single',
    src: ORDER_CARDAPIO_IMAGE_PATHS.mistaGoiabada,
    objectPosition: 'center center'
  },
  D: {
    mode: 'single',
    src: ORDER_CARDAPIO_IMAGE_PATHS.mistaDoceDeLeite,
    objectPosition: 'center center'
  },
  Q: {
    mode: 'single',
    src: ORDER_CARDAPIO_IMAGE_PATHS.mistaQueijoDoSerro,
    objectPosition: 'center center'
  },
  R: {
    mode: 'single',
    src: ORDER_CARDAPIO_IMAGE_PATHS.mistaRequeijaoDeCorte,
    objectPosition: 'center center'
  },
  RJ: {
    mode: 'single',
    src: ORDER_CARDAPIO_IMAGE_PATHS.mistaRomeuEJulieta,
    objectPosition: 'center center'
  }
};

export const ORDER_BOX_CATALOG = {
  T: {
    label: 'Tradicional',
    codeLabel: 'T',
    detail: '1 caixa = 7 broas tradicionais',
    art: ORDER_FLAVOR_CARD_ART_BY_CODE.T,
    accentClassName:
      'border-[color:var(--tone-cream-line)] bg-[linear-gradient(165deg,var(--tone-cream-surface),rgba(255,253,249,0.98))]',
    units: { T: 7, G: 0, D: 0, Q: 0, R: 0, RJ: 0 },
    priceEstimate: 40
  },
  G: {
    label: 'Goiabada',
    codeLabel: 'G',
    detail: '1 caixa = 7 broas de goiabada',
    art: ORDER_FLAVOR_CARD_ART_BY_CODE.G,
    accentClassName:
      'border-[color:var(--tone-blush-line)] bg-[linear-gradient(165deg,var(--tone-blush-surface),rgba(255,250,248,0.98))]',
    units: { T: 0, G: 7, D: 0, Q: 0, R: 0, RJ: 0 },
    priceEstimate: 50
  },
  D: {
    label: 'Doce de Leite',
    codeLabel: 'D',
    detail: '1 caixa = 7 broas de doce de leite',
    art: ORDER_FLAVOR_CARD_ART_BY_CODE.D,
    accentClassName:
      'border-[color:var(--tone-gold-line)] bg-[linear-gradient(165deg,var(--tone-gold-surface),rgba(255,251,246,0.98))]',
    units: { T: 0, G: 0, D: 7, Q: 0, R: 0, RJ: 0 },
    priceEstimate: 52
  },
  Q: {
    label: 'Queijo do Serro',
    codeLabel: 'Q',
    detail: '1 caixa = 7 broas de queijo do serro',
    art: ORDER_FLAVOR_CARD_ART_BY_CODE.Q,
    accentClassName:
      'border-[color:var(--tone-sage-line)] bg-[linear-gradient(165deg,var(--tone-sage-surface),rgba(252,254,252,0.97))]',
    units: { T: 0, G: 0, D: 0, Q: 7, R: 0, RJ: 0 },
    priceEstimate: 52
  },
  R: {
    label: 'Requeijão de Corte',
    codeLabel: 'R',
    detail: '1 caixa = 7 broas de requeijão de corte',
    art: ORDER_FLAVOR_CARD_ART_BY_CODE.R,
    accentClassName:
      'border-[color:var(--tone-olive-line)] bg-[linear-gradient(165deg,var(--tone-olive-surface),rgba(254,252,248,0.98))]',
    units: { T: 0, G: 0, D: 0, Q: 0, R: 7, RJ: 0 },
    priceEstimate: 52
  },
  RJ: {
    label: 'Romeu e Julieta',
    codeLabel: 'RJ',
    detail: '1 caixa = 7 broas de romeu e julieta',
    art: ORDER_FLAVOR_CARD_ART_BY_CODE.RJ,
    accentClassName:
      'border-[color:var(--tone-roast-line)] bg-[linear-gradient(165deg,var(--tone-roast-surface),rgba(253,246,242,0.98))]',
    units: { T: 0, G: 0, D: 0, Q: 0, R: 0, RJ: 7 },
    priceEstimate: 52
  },
  MG: {
    label: 'Mista Goiabada',
    codeLabel: 'MG',
    detail: '1 caixa = 4 tradicionais + 3 goiabada',
    art: ORDER_MISTA_CARD_ART_BY_CODE.G,
    accentClassName:
      'border-[color:var(--tone-blush-line)] bg-[linear-gradient(165deg,var(--tone-blush-surface),rgba(253,246,242,0.98))]',
    units: { T: 4, G: 3, D: 0, Q: 0, R: 0, RJ: 0 },
    priceEstimate: 45
  },
  MD: {
    label: 'Mista Doce de Leite',
    codeLabel: 'MD',
    detail: '1 caixa = 4 tradicionais + 3 doce de leite',
    art: ORDER_MISTA_CARD_ART_BY_CODE.D,
    accentClassName:
      'border-[color:var(--tone-gold-line)] bg-[linear-gradient(165deg,var(--tone-gold-surface),rgba(251,242,232,0.98))]',
    units: { T: 4, G: 0, D: 3, Q: 0, R: 0, RJ: 0 },
    priceEstimate: 47
  },
  MQ: {
    label: 'Mista Queijo do Serro',
    codeLabel: 'MQ',
    detail: '1 caixa = 4 tradicionais + 3 queijo do serro',
    art: ORDER_MISTA_CARD_ART_BY_CODE.Q,
    accentClassName:
      'border-[color:var(--tone-sage-line)] bg-[linear-gradient(165deg,var(--tone-sage-surface),rgba(246,243,236,0.98))]',
    units: { T: 4, G: 0, D: 0, Q: 3, R: 0, RJ: 0 },
    priceEstimate: 47
  },
  MR: {
    label: 'Mista Requeijão de Corte',
    codeLabel: 'MR',
    detail: '1 caixa = 4 tradicionais + 3 requeijão de corte',
    art: ORDER_MISTA_CARD_ART_BY_CODE.R,
    accentClassName:
      'border-[color:var(--tone-olive-line)] bg-[linear-gradient(165deg,var(--tone-olive-surface),rgba(250,244,232,0.98))]',
    units: { T: 4, G: 0, D: 0, Q: 0, R: 3, RJ: 0 },
    priceEstimate: 47
  },
  MRJ: {
    label: 'Mista Romeu e Julieta',
    codeLabel: 'MRJ',
    detail: '1 caixa = 4 tradicionais + 3 romeu e julieta',
    art: ORDER_MISTA_CARD_ART_BY_CODE.RJ,
    accentClassName:
      'border-[color:var(--tone-roast-line)] bg-[linear-gradient(165deg,var(--tone-roast-surface),rgba(253,246,242,0.98))]',
    units: { T: 4, G: 0, D: 0, Q: 0, R: 0, RJ: 3 },
    priceEstimate: 47
  }
} as const;

export type OrderBoxCode = keyof typeof ORDER_BOX_CATALOG;

export function buildOrderBoxCatalogContentId(code: OrderBoxCode) {
  return `${ORDER_BOX_CATALOG_CONTENT_ID_PREFIX}${code}`;
}

export function resolveOrderCatalogPrefillCodeFromCatalogContentId(
  value?: string | null
): OrderCatalogPrefillCode | null {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return null;

  const candidate = normalized.startsWith(ORDER_BOX_CATALOG_CONTENT_ID_PREFIX)
    ? normalized.slice(ORDER_BOX_CATALOG_CONTENT_ID_PREFIX.length)
    : normalized;

  if (candidate === ORDER_CUSTOM_BOX_CATALOG_CODE) {
    return ORDER_CUSTOM_BOX_CATALOG_CODE;
  }

  return Object.prototype.hasOwnProperty.call(ORDER_BOX_CATALOG, candidate)
    ? (candidate as OrderBoxCode)
    : null;
}

export function resolveOrderBoxCodeFromCatalogContentId(value?: string | null): OrderBoxCode | null {
  const code = resolveOrderCatalogPrefillCodeFromCatalogContentId(value);
  return code === ORDER_CUSTOM_BOX_CATALOG_CODE ? null : code;
}

export function parseMetaCheckoutProductsParam(value?: string | null) {
  const counts = Object.keys(ORDER_BOX_CATALOG).reduce(
    (accumulator, code) => {
      accumulator[code as OrderBoxCode] = 0;
      return accumulator;
    },
    {} as Record<OrderBoxCode, number>
  );
  let customBoxCount = 0;

  for (const entry of String(value || '').split(',')) {
    const [rawProductId = '', rawQuantity = ''] = entry.split(':');
    const code = resolveOrderCatalogPrefillCodeFromCatalogContentId(rawProductId);
    const quantity = Math.max(Math.floor(Number(rawQuantity) || 0), 0);
    if (!code || quantity <= 0) continue;
    if (code === ORDER_CUSTOM_BOX_CATALOG_CODE) {
      customBoxCount += quantity;
      continue;
    }
    counts[code] += quantity;
  }

  return {
    boxes: counts,
    customBoxCount
  };
}

export const ORDER_BRAND_GALLERY_IMAGES = [
  {
    src: ORDER_CARDAPIO_IMAGE_PATHS.sabores,
    alt: 'Selecao de sabores QUEROBROA',
    className: 'left-0 top-6 h-[220px] w-[180px] sm:h-[250px] sm:w-[210px]',
    transform: 'translate3d(0px, 0px, 0px) rotate(-8deg)'
  },
  {
    src: ORDER_CARDAPIO_IMAGE_PATHS.queijoDoSerro,
    alt: 'Queijo do Serro do cardapio',
    className: 'right-3 top-0 h-[200px] w-[150px] sm:h-[220px] sm:w-[170px]',
    transform: 'translate3d(0px, -10px, 20px) rotate(9deg)'
  },
  {
    src: ORDER_CARDAPIO_IMAGE_PATHS.goiabada,
    alt: 'Goiabada do cardapio',
    className: 'right-0 top-[190px] h-[160px] w-[130px] sm:top-[210px] sm:h-[180px] sm:w-[145px]',
    transform: 'translate3d(0px, 0px, 40px) rotate(6deg)'
  },
  {
    src: ORDER_CARDAPIO_IMAGE_PATHS.doceDeLeite,
    alt: 'Doce de leite do cardapio',
    className: 'left-[130px] top-[220px] h-[190px] w-[150px] sm:left-[170px] sm:top-[240px] sm:h-[210px] sm:w-[170px]',
    transform: 'translate3d(0px, 0px, 30px) rotate(-5deg)'
  }
] as const;

export function compactOrderProductName(name: string) {
  const normalized = normalizeOrderFlavorName(name);
  if (normalized.includes('pascoa')) {
    return 'Broas de Páscoa';
  }
  const compacted = name
    .replace(/^Broa\s+/i, '')
    .replace(/\s*\(([A-Z]{1,3})\)\s*$/i, '')
    .trim();
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

export function normalizeOrderFlavorCategory(value?: string | null) {
  return normalizeOrderFlavorName(value);
}

export function isRuntimeOrderCompanionCategory(value?: string | null) {
  const normalized = normalizeOrderFlavorCategory(value);
  return normalized.includes('amigos da broa') || normalized.includes('amigas da broa');
}

export function resolveOrderFlavorCodeFromName(value?: string | null): OrderFlavorCode | null {
  const normalized = normalizeOrderFlavorName(value);
  if (!normalized) return null;
  if (normalized.includes('tradicional')) return 'T';
  if (normalized.includes('goiabada')) return 'G';
  if (normalized.includes('doce')) return 'D';
  if (normalized.includes('romeu') || normalized.includes('julieta')) return 'RJ';
  if (normalized.includes('queijo') && !normalized.includes('requeij')) return 'Q';
  if (normalized.includes('requeij')) return 'R';
  return null;
}

export function resolveRuntimeOrderFlavorKind(value?: string | null): RuntimeOrderFlavorKind {
  const code = resolveOrderFlavorCodeFromName(value);
  if (code === 'T') return 'TRADITIONAL';
  if (code === 'G') return 'GOIABADA';
  return 'PREMIUM';
}

type OrderProductArtSource = Pick<
  Product,
  | 'id'
  | 'name'
  | 'category'
  | 'imageUrl'
  | 'active'
  | 'measureLabel'
  | 'drawerNote'
  | 'companionInventory'
  | 'inventoryQtyPerSaleUnit'
> & {
  price?: number | null;
  unit?: string | null;
  salesLimitExhausted?: boolean | null;
};

function isRuntimeOrderFlavorProductSource(
  product?: Pick<OrderProductArtSource, 'name' | 'category'> | null
) {
  const normalizedName = normalizeOrderFlavorName(product?.name);
  const normalizedCategory = normalizeOrderFlavorCategory(product?.category);
  return (
    normalizedName.startsWith('broa ') &&
    !normalizedName.includes('mista') &&
    (normalizedCategory === 'sabores' || !normalizedCategory)
  );
}

function isRuntimeOrderFallbackFlavorProductSource(
  product?: Pick<OrderProductArtSource, 'name' | 'category'> | null
) {
  const normalizedName = normalizeOrderFlavorName(product?.name);
  return (
    normalizedName.startsWith('broa ') &&
    !normalizedName.includes('mista') &&
    !isRuntimeOrderCompanionCategory(product?.category)
  );
}

export function resolveRuntimeOrderItemGroup(
  product?: Pick<OrderProductArtSource, 'name' | 'category'> | null
): 'FLAVOR' | 'COMPANION' | 'OTHER' {
  if (isRuntimeOrderCompanionCategory(product?.category)) {
    return 'COMPANION';
  }
  if (isRuntimeOrderFlavorProductSource(product) || isRuntimeOrderFallbackFlavorProductSource(product)) {
    return 'FLAVOR';
  }
  return 'OTHER';
}

export function isRuntimeOrderCompanionTemporarilyOutOfStock(
  product?: Pick<OrderProductArtSource, 'category' | 'companionInventory'> | null
) {
  if (!isRuntimeOrderCompanionCategory(product?.category)) {
    return false;
  }

  const balance = product?.companionInventory?.balance;
  return typeof balance === 'number' && Number.isFinite(balance) && balance <= 0;
}

function findOrderFlavorProductByCode(
  code: OrderFlavorCode,
  products?: ReadonlyArray<OrderProductArtSource> | null
) {
  return (products || []).find((product) => {
    return product.active !== false &&
      product.salesLimitExhausted !== true &&
      isRuntimeOrderFallbackFlavorProductSource(product) &&
      resolveOrderFlavorCodeFromName(product.name) === code;
  });
}

function applyProductImageToSingleArt(
  art: Extract<OrderCardArt, { mode: 'single' }>,
  imageUrl?: string | null
) {
  const normalizedImageUrl = String(imageUrl || '').trim();
  return normalizedImageUrl ? { ...art, src: normalizedImageUrl } : art;
}

export function resolveOrderFlavorCardArt(
  code: OrderFlavorCode,
  products?: ReadonlyArray<OrderProductArtSource> | null
) {
  return applyProductImageToSingleArt(
    ORDER_FLAVOR_CARD_ART_BY_CODE[code],
    findOrderFlavorProductByCode(code, products)?.imageUrl
  );
}

export function resolveOrderSaboresCardArt(products?: ReadonlyArray<OrderProductArtSource> | null): OrderCardArt {
  const runtimeCatalog = buildRuntimeOrderCatalog(products);
  if (runtimeCatalog.flavorProducts.length > 0) {
    return {
      mode: 'columns',
      columns: runtimeCatalog.flavorProducts.map((product) => {
        const art = resolveOrderCardArt(product);
        return art.mode === 'single'
          ? {
              src: art.src,
              objectPosition: art.objectPosition
            }
          : {
              src: ORDER_SABORES_REFERENCE_IMAGE
            };
      })
    };
  }
  return {
    mode: 'columns',
    columns: ORDER_FLAVOR_CODES.map((code) => {
      const art = resolveOrderFlavorCardArt(code, products);
      return {
        src: art.src,
        objectPosition: art.objectPosition
      };
    })
  };
}

export function buildRuntimeOrderBoxCatalog(products?: ReadonlyArray<OrderProductArtSource> | null) {
  return {
    ...ORDER_BOX_CATALOG,
    T: { ...ORDER_BOX_CATALOG.T, art: resolveOrderFlavorCardArt('T', products) },
    G: { ...ORDER_BOX_CATALOG.G, art: resolveOrderFlavorCardArt('G', products) },
    D: { ...ORDER_BOX_CATALOG.D, art: resolveOrderFlavorCardArt('D', products) },
    Q: { ...ORDER_BOX_CATALOG.Q, art: resolveOrderFlavorCardArt('Q', products) },
    R: { ...ORDER_BOX_CATALOG.R, art: resolveOrderFlavorCardArt('R', products) },
    RJ: { ...ORDER_BOX_CATALOG.RJ, art: resolveOrderFlavorCardArt('RJ', products) },
    MG: { ...ORDER_BOX_CATALOG.MG, art: resolveOrderMistaCardArt('G', products) },
    MD: { ...ORDER_BOX_CATALOG.MD, art: resolveOrderMistaCardArt('D', products) },
    MQ: { ...ORDER_BOX_CATALOG.MQ, art: resolveOrderMistaCardArt('Q', products) },
    MR: { ...ORDER_BOX_CATALOG.MR, art: resolveOrderMistaCardArt('R', products) },
    MRJ: { ...ORDER_BOX_CATALOG.MRJ, art: resolveOrderMistaCardArt('RJ', products) }
  };
}

export function resolveOrderCardImage(product?: OrderProductArtSource | string | null) {
  const productName = typeof product === 'string' ? product : product?.name;
  const explicitImageUrl = typeof product === 'string' ? null : String(product?.imageUrl || '').trim() || null;
  if (explicitImageUrl) return explicitImageUrl;
  const code = resolveOrderFlavorCodeFromName(productName);
  if (!code) return ORDER_SABORES_REFERENCE_IMAGE;
  const art = applyProductImageToSingleArt(ORDER_FLAVOR_CARD_ART_BY_CODE[code], explicitImageUrl);
  return art.src || ORDER_SABORES_REFERENCE_IMAGE;
}

export function resolveOrderCardArt(product?: OrderProductArtSource | string | null) {
  const productName = typeof product === 'string' ? product : product?.name;
  const explicitImageUrl = typeof product === 'string' ? null : String(product?.imageUrl || '').trim() || null;
  const companionImageUrl =
    resolveCompanionProductCanonicalImageUrl(
      typeof product === 'string' ? { name: product } : { name: product?.name, drawerNote: product?.drawerNote }
    ) || null;

  if (explicitImageUrl || companionImageUrl) {
    return {
      mode: 'single',
      src: explicitImageUrl || companionImageUrl || ORDER_SABORES_REFERENCE_IMAGE,
      objectPosition: 'center center'
    } satisfies OrderCardArt;
  }
  const code = resolveOrderFlavorCodeFromName(productName);
  return code
    ? applyProductImageToSingleArt(ORDER_FLAVOR_CARD_ART_BY_CODE[code], explicitImageUrl)
    : ORDER_GENERIC_CARD_ART;
}

export function resolveOrderMistaCardArt(
  code: OrderMistaShortcutCode,
  products?: ReadonlyArray<OrderProductArtSource> | null
) {
  const traditionalArt = resolveOrderFlavorCardArt('T', products);
  const pairedArt = resolveOrderFlavorCardArt(code, products);

  return {
    mode: 'split',
    leftSrc: traditionalArt.src,
    rightSrc: pairedArt.src,
    leftObjectPosition: traditionalArt.objectPosition,
    rightObjectPosition: pairedArt.objectPosition
  } satisfies OrderCardArt;
}

export function resolveOrderMistaDrawerArt(code: OrderMistaShortcutCode): OrderCardArt {
  return ORDER_MISTA_DRAWER_ART_BY_CODE[code];
}

function resolveRuntimeOrderMixedCardArt(
  traditionalFlavor: RuntimeOrderFlavorProduct,
  product: RuntimeOrderFlavorProduct
) {
  return {
    mode: 'split',
    leftSrc: resolveOrderCardImage(traditionalFlavor),
    rightSrc: resolveOrderCardImage(product),
    leftObjectPosition: 'center center',
    rightObjectPosition: 'center center'
  } satisfies OrderCardArt;
}

function resolveRuntimeOrderMixedDrawerArt(product: RuntimeOrderFlavorProduct) {
  if (
    product.legacyCode &&
    Object.prototype.hasOwnProperty.call(ORDER_MISTA_DRAWER_ART_BY_CODE, product.legacyCode)
  ) {
    return resolveOrderMistaDrawerArt(product.legacyCode as OrderMistaShortcutCode);
  }

  return {
    mode: 'single',
    src: resolveOrderCardImage(product),
    objectPosition: 'center center'
  } satisfies OrderCardArt;
}

function resolveRuntimeOrderSingleBoxPrice(kind: RuntimeOrderFlavorKind) {
  if (kind === 'TRADITIONAL') return ORDER_BOX_PRICE_TRADITIONAL;
  if (kind === 'GOIABADA') return ORDER_BOX_PRICE_GOIABADA;
  return ORDER_BOX_PRICE_CUSTOM;
}

function resolveRuntimeOrderMixedBoxPrice(kind: RuntimeOrderFlavorKind) {
  return kind === 'GOIABADA' ? ORDER_BOX_PRICE_MIXED_GOIABADA : ORDER_BOX_PRICE_MIXED_OTHER;
}

function resolveRuntimeOrderAccentClass(kind: RuntimeOrderFlavorKind, mode: 'SINGLE' | 'MIXED') {
  if (mode === 'MIXED') {
    if (kind === 'GOIABADA') {
      return 'border-[color:var(--tone-blush-line)] bg-[linear-gradient(165deg,var(--tone-blush-surface),rgba(253,246,242,0.98))]';
    }
    return 'border-[color:var(--tone-roast-line)] bg-[linear-gradient(165deg,var(--tone-roast-surface),rgba(253,246,242,0.98))]';
  }

  if (kind === 'TRADITIONAL') {
    return 'border-[color:var(--tone-cream-line)] bg-[linear-gradient(165deg,var(--tone-cream-surface),rgba(255,253,249,0.98))]';
  }
  if (kind === 'GOIABADA') {
    return 'border-[color:var(--tone-blush-line)] bg-[linear-gradient(165deg,var(--tone-blush-surface),rgba(255,250,248,0.98))]';
  }
  return 'border-[color:var(--tone-olive-line)] bg-[linear-gradient(165deg,var(--tone-olive-surface),rgba(254,252,248,0.98))]';
}

function buildRuntimeOrderLegacyBoxCode(product: RuntimeOrderFlavorProduct, mode: 'SINGLE' | 'MIXED'): OrderBoxCode | null {
  if (!product.legacyCode) return null;
  if (mode === 'SINGLE') return product.legacyCode;
  if (product.legacyCode === 'T' || product.legacyCode.length > 1) return null;
  return `M${product.legacyCode}` as OrderBoxCode;
}

function resolveRuntimeOrderProductDetailLabel(product: Pick<RuntimeOrderFlavorProduct, 'name' | 'label'>) {
  const normalized = normalizeOrderFlavorName(product.name);
  if (normalized.includes('pascoa')) {
    return 'broas de chocolate';
  }
  return `broas de ${product.label.toLowerCase()}`;
}

export function buildRuntimeOrderCatalog(
  products?: ReadonlyArray<OrderProductArtSource> | null
): RuntimeOrderCatalog {
  const activeProducts = (products || []).filter(
    (product): product is OrderProductArtSource & { id: number } =>
      typeof product.id === 'number' && product.active !== false && product.salesLimitExhausted !== true
  );
  const companionSourceProducts = (products || []).filter(
    (product): product is OrderProductArtSource & { id: number } =>
      typeof product.id === 'number' &&
      resolveRuntimeOrderItemGroup(product) === 'COMPANION' &&
      product.salesLimitExhausted !== true &&
      (product.active !== false || isRuntimeOrderCompanionTemporarilyOutOfStock(product))
  );
  const canonicalProducts = activeProducts.filter((product) => isRuntimeOrderFlavorProductSource(product));
  const fallbackProducts = activeProducts.filter((product) => isRuntimeOrderFallbackFlavorProductSource(product));
  const sourceProducts = canonicalProducts.length > 0 ? canonicalProducts : fallbackProducts;

  const flavorProducts = sourceProducts
    .map((product) => {
      const legacyCode = resolveOrderFlavorCodeFromName(product.name);
      return {
        id: product.id,
        key: `product:${product.id}`,
        name: product.name,
        category: product.category ?? null,
        active: true,
        label: compactOrderProductName(product.name),
        kind: resolveRuntimeOrderFlavorKind(product.name),
        legacyCode,
        imageUrl: product.imageUrl ?? null
      } satisfies RuntimeOrderFlavorProduct;
    })
    .sort((left, right) => {
      const kindWeight = { TRADITIONAL: 0, GOIABADA: 1, PREMIUM: 2 } satisfies Record<RuntimeOrderFlavorKind, number>;
      const legacyWeight = { T: 0, G: 1, D: 2, Q: 3, R: 4, RJ: 5 } satisfies Record<OrderFlavorCode, number>;
      const leftKindWeight = kindWeight[left.kind];
      const rightKindWeight = kindWeight[right.kind];
      if (leftKindWeight !== rightKindWeight) return leftKindWeight - rightKindWeight;
      if (left.legacyCode && right.legacyCode) {
        const delta = legacyWeight[left.legacyCode] - legacyWeight[right.legacyCode];
        if (delta !== 0) return delta;
      } else if (left.legacyCode || right.legacyCode) {
        return left.legacyCode ? -1 : 1;
      }
      return left.label.localeCompare(right.label, 'pt-BR');
    });

  const flavorProductById = new Map(flavorProducts.map((product) => [product.id, product] as const));
  const flavorProductByLegacyCode = flavorProducts.reduce(
    (accumulator, product) => {
      if (product.legacyCode && !accumulator[product.legacyCode]) {
        accumulator[product.legacyCode] = product;
      }
      return accumulator;
    },
    {} as Partial<Record<OrderFlavorCode, RuntimeOrderFlavorProduct>>
  );
  const traditionalFlavor =
    flavorProducts.find((product) => product.kind === 'TRADITIONAL') || null;
  const companionProducts = companionSourceProducts
    .map((product) => {
      const profile = resolveCompanionProductProfile(product);
      const label = buildCompanionProductName(profile) || compactOrderProductName(product.name);
      const imageUrl = product.imageUrl || resolveCompanionProductCanonicalImageUrl(product) || null;
      const temporarilyOutOfStock = isRuntimeOrderCompanionTemporarilyOutOfStock(product);
      return {
        id: product.id,
        key: `companion:${product.id}`,
        name: product.name,
        category: product.category ?? null,
        active: product.active !== false,
        temporarilyOutOfStock,
        label,
        displayTitle: profile?.title || compactOrderProductName(product.name),
        displayFlavor: profile?.flavor ?? null,
        displayMakerLine: buildCompanionProductMakerLine(profile),
        imageUrl,
        price: Number(product.price || 0),
        unit: product.unit ?? null,
        measureLabel: product.measureLabel ?? null,
        drawerNote: product.drawerNote ?? null
      } satisfies RuntimeOrderCompanionProduct;
    })
    .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));
  const companionProductById = new Map(companionProducts.map((product) => [product.id, product] as const));
  const companionProductByKey = new Map(companionProducts.map((product) => [product.key, product] as const));

  const singleEntries = flavorProducts.map((product) => {
    const legacyCode = buildRuntimeOrderLegacyBoxCode(product, 'SINGLE');
    return {
      key: `single:${product.id}`,
      kind: 'SINGLE' as const,
      label: product.label,
      detail:
        product.kind === 'TRADITIONAL'
          ? '1 caixa = 7 broas tradicionais'
          : `1 caixa = 7 ${resolveRuntimeOrderProductDetailLabel(product)}`,
      art: resolveOrderCardArt(product),
      accentClassName: resolveRuntimeOrderAccentClass(product.kind, 'SINGLE'),
      priceEstimate: resolveRuntimeOrderSingleBoxPrice(product.kind),
      unitsByProductId: { [product.id]: ORDER_BOX_UNITS },
      productId: product.id,
      legacyCode
    } satisfies RuntimeOrderBoxEntry;
  });

  const mixedEntries =
    traditionalFlavor == null
      ? []
      : flavorProducts
          .filter((product) => product.id !== traditionalFlavor.id)
          .map((product) => {
            const legacyCode = buildRuntimeOrderLegacyBoxCode(product, 'MIXED');
            const label =
              product.legacyCode &&
              Object.prototype.hasOwnProperty.call(ORDER_MISTA_OFFICIAL_BOX_NAME_BY_CODE, product.legacyCode)
                ? ORDER_MISTA_OFFICIAL_BOX_NAME_BY_CODE[product.legacyCode as OrderMistaShortcutCode]
                : `Mista ${product.label}`;
            return {
              key: `mixed:${product.id}`,
              kind: 'MIXED' as const,
              label,
              detail: `1 caixa = 4 tradicionais + 3 ${resolveRuntimeOrderProductDetailLabel(product)}`,
              art: resolveRuntimeOrderMixedCardArt(traditionalFlavor, product),
              drawerArt: resolveRuntimeOrderMixedDrawerArt(product),
              accentClassName: resolveRuntimeOrderAccentClass(product.kind, 'MIXED'),
              priceEstimate: resolveRuntimeOrderMixedBoxPrice(product.kind),
              unitsByProductId: {
                [traditionalFlavor.id]: 4,
                [product.id]: 3
              },
              productId: product.id,
              legacyCode
            } satisfies RuntimeOrderBoxEntry;
          });

  const boxEntries = [...singleEntries, ...mixedEntries];
  const boxEntryByKey = new Map(boxEntries.map((entry) => [entry.key, entry] as const));
  const boxKeyByLegacyCode = boxEntries.reduce(
    (accumulator, entry) => {
      if (entry.legacyCode && !accumulator[entry.legacyCode]) {
        accumulator[entry.legacyCode] = entry.key;
      }
      return accumulator;
    },
    {} as Partial<Record<OrderBoxCode, string>>
  );

  return {
    flavorProducts,
    flavorProductById,
    flavorProductByLegacyCode,
    traditionalFlavor,
    companionProducts,
    companionProductById,
    companionProductByKey,
    boxEntries,
    boxEntryByKey,
    boxKeyByLegacyCode
  };
}

export function resolveRuntimeOrderBoxKey(
  key: string,
  catalog: Pick<RuntimeOrderCatalog, 'boxEntryByKey' | 'boxKeyByLegacyCode'>
) {
  if (catalog.boxEntryByKey.has(key)) return key;
  const legacyCode = resolveOrderBoxCodeFromCatalogContentId(key);
  return legacyCode ? catalog.boxKeyByLegacyCode[legacyCode] ?? null : null;
}

export function resolveRuntimeOrderFlavorProductId(
  key: string,
  catalog: Pick<RuntimeOrderCatalog, 'flavorProductById' | 'flavorProductByLegacyCode'>
) {
  const normalized = String(key || '').trim();
  if (/^\d+$/.test(normalized)) {
    const productId = Number(normalized);
    return catalog.flavorProductById.has(productId) ? productId : null;
  }
  const legacyProduct = catalog.flavorProductByLegacyCode[normalized as OrderFlavorCode];
  return legacyProduct?.id ?? null;
}

export function resolveRuntimeOrderCompanionProductId(
  key: string,
  catalog: Pick<RuntimeOrderCatalog, 'companionProductById' | 'companionProductByKey'>
) {
  const normalized = String(key || '').trim();
  if (catalog.companionProductByKey.has(normalized)) {
    return catalog.companionProductByKey.get(normalized)?.id ?? null;
  }
  if (/^\d+$/.test(normalized)) {
    const productId = Number(normalized);
    return catalog.companionProductById.has(productId) ? productId : null;
  }
  const prefixedKey = `companion:${normalized}`;
  return catalog.companionProductByKey.get(prefixedKey)?.id ?? null;
}

function sumTriplets(counts: number[]) {
  return counts.reduce((sum, quantity) => sum + Math.floor(Math.max(quantity, 0) / 3), 0);
}

function maxSameFlavorFullBoxesAfterTriplets(counts: number[], tripletsToUse: number) {
  const normalizedCounts = counts.map((quantity) => Math.max(Math.floor(quantity || 0), 0));
  const memo = new Map<string, number>();

  const walk = (index: number, remainingTriplets: number): number => {
    const memoKey = `${index}:${remainingTriplets}`;
    const cached = memo.get(memoKey);
    if (typeof cached === 'number') return cached;

    if (index >= normalizedCounts.length) {
      return remainingTriplets === 0 ? 0 : Number.NEGATIVE_INFINITY;
    }

    const quantity = normalizedCounts[index] || 0;
    const maxTripletsHere = Math.min(Math.floor(quantity / 3), remainingTriplets);
    let best = Number.NEGATIVE_INFINITY;
    for (let usedTriplets = 0; usedTriplets <= maxTripletsHere; usedTriplets += 1) {
      const remainingBoxes = walk(index + 1, remainingTriplets - usedTriplets);
      if (!Number.isFinite(remainingBoxes)) continue;
      const totalBoxes = Math.floor((quantity - usedTriplets * 3) / ORDER_BOX_UNITS) + remainingBoxes;
      if (totalBoxes > best) best = totalBoxes;
    }

    memo.set(memoKey, best);
    return best;
  };

  const result = walk(0, Math.max(Math.floor(tripletsToUse || 0), 0));
  return Number.isFinite(result) ? result : 0;
}

export function calculateOrderSubtotalFromProductItems(
  items: Array<{ productId: number; quantity: number }>,
  productMap: ReadonlyMap<number, Pick<Product, 'id' | 'name' | 'category' | 'price'>>
) {
  const quantityByProductId = new Map<number, number>();
  let totalUnits = 0;
  let directSubtotalMinorUnits = 0;

  for (const item of items) {
    const quantity = Math.max(Math.floor(item.quantity || 0), 0);
    if (quantity <= 0) continue;
    const product = productMap.get(item.productId);
    if (resolveRuntimeOrderItemGroup(product) === 'FLAVOR') {
      totalUnits += quantity;
      quantityByProductId.set(item.productId, (quantityByProductId.get(item.productId) || 0) + quantity);
      continue;
    }
    directSubtotalMinorUnits += moneyToMinorUnits(Number(product?.price || 0)) * quantity;
  }

  if (totalUnits <= 0) {
    return moneyFromMinorUnits(directSubtotalMinorUnits);
  }

  const fullBoxes = Math.floor(totalUnits / ORDER_BOX_UNITS);
  const openUnits = totalUnits % ORDER_BOX_UNITS;
  if (fullBoxes <= 0) {
    return moneyFromMinorUnits(Math.round((ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS / ORDER_BOX_UNITS) * openUnits));
  }

  let traditionalCount = 0;
  const goiabadaCounts: number[] = [];
  const premiumCounts: number[] = [];

  for (const [productId, quantity] of quantityByProductId.entries()) {
    const kind = resolveRuntimeOrderFlavorKind(productMap.get(productId)?.name);
    if (kind === 'TRADITIONAL') {
      traditionalCount += quantity;
      continue;
    }
    if (kind === 'GOIABADA') {
      goiabadaCounts.push(quantity);
      continue;
    }
    premiumCounts.push(quantity);
  }

  const goiabadaTriplets = sumTriplets(goiabadaCounts);
  const premiumTriplets = sumTriplets(premiumCounts);
  const discountTraditional = ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS - ORDER_BOX_PRICE_TRADITIONAL_MINOR_UNITS;
  const discountMixedGoiabada =
    ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS - ORDER_BOX_PRICE_MIXED_GOIABADA_MINOR_UNITS;
  const discountMixedOther = ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS - ORDER_BOX_PRICE_MIXED_OTHER_MINOR_UNITS;
  const discountGoiabada = ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS - ORDER_BOX_PRICE_GOIABADA_MINOR_UNITS;

  let bestDiscount = 0;
  const maxMixedGoiabada = Math.min(goiabadaTriplets, Math.floor(traditionalCount / 4), fullBoxes);

  for (let mixedGoiabada = 0; mixedGoiabada <= maxMixedGoiabada; mixedGoiabada += 1) {
    const remainingTraditionalAfterMixedGoiabada = traditionalCount - mixedGoiabada * 4;
    const maxMixedOther = Math.min(
      premiumTriplets,
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
        const goiabadaBoxes = Math.min(
          maxSameFlavorFullBoxesAfterTriplets(goiabadaCounts, mixedGoiabada),
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

  const fullBoxesSubtotal = fullBoxes * ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS - bestDiscount;
  const openSubtotal =
    openUnits > 0 ? Math.round((ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS / ORDER_BOX_UNITS) * openUnits) : 0;

  return moneyFromMinorUnits(fullBoxesSubtotal + openSubtotal + directSubtotalMinorUnits);
}

export function calculateCouponEligibleSubtotalFromProductItems(
  items: Array<{ productId: number; quantity: number }>,
  productMap: ReadonlyMap<number, Pick<Product, 'id' | 'name' | 'category' | 'price'>>
) {
  return calculateOrderSubtotalFromProductItems(
    items.filter((item) => resolveRuntimeOrderItemGroup(productMap.get(item.productId)) === 'FLAVOR'),
    productMap
  );
}

export function formatOrderProductComposition(
  items: Array<{ productId: number; quantity: number }>,
  productMap: ReadonlyMap<number, Pick<Product, 'id' | 'name' | 'category'>>
) {
  const quantities = new Map<number, number>();

  for (const item of items) {
    const quantity = Math.max(Math.floor(item.quantity || 0), 0);
    if (quantity <= 0) continue;
    quantities.set(item.productId, (quantities.get(item.productId) || 0) + quantity);
  }

  const entries = Array.from(quantities.entries())
    .map(([productId, quantity]) => ({
      productId,
      quantity,
      label: compactOrderProductName(productMap.get(productId)?.name ?? `Produto ${productId}`),
      kind: resolveRuntimeOrderFlavorKind(productMap.get(productId)?.name),
      group: resolveRuntimeOrderItemGroup(productMap.get(productId))
    }))
    .sort((left, right) => {
      const groupWeight = { FLAVOR: 0, COMPANION: 1, OTHER: 2 } satisfies Record<
        'FLAVOR' | 'COMPANION' | 'OTHER',
        number
      >;
      const groupDelta = groupWeight[left.group] - groupWeight[right.group];
      if (groupDelta !== 0) return groupDelta;
      const kindWeight = { TRADITIONAL: 0, GOIABADA: 1, PREMIUM: 2 } satisfies Record<RuntimeOrderFlavorKind, number>;
      const delta = kindWeight[left.kind] - kindWeight[right.kind];
      if (delta !== 0) return delta;
      return left.label.localeCompare(right.label, 'pt-BR');
    });

  return entries.length
    ? entries.map((entry) => `${entry.quantity} ${entry.label}`).join(' • ')
    : 'Nenhum item calculado ainda';
}

export function resolveOrderVirtualBoxLabel(
  parts: Array<{ productName: string; units: number }>
) {
  const normalizedParts = parts
    .map((part) => ({
      productName: compactOrderProductName(part.productName),
      kind: resolveRuntimeOrderFlavorKind(part.productName),
      units: Math.max(Math.floor(part.units || 0), 0)
    }))
    .filter((part) => part.units > 0);

  if (normalizedParts.length === 2) {
    const traditionalPart = normalizedParts.find((part) => part.kind === 'TRADITIONAL' && part.units === 4);
    const pairedFlavorPart = normalizedParts.find((part) => part.kind !== 'TRADITIONAL' && part.units === 3);
    if (traditionalPart && pairedFlavorPart) {
      return `Caixa Mista de ${pairedFlavorPart.productName}`;
    }
  }

  if (normalizedParts.length === 1 && normalizedParts[0]?.units === ORDER_BOX_UNITS) {
    const single = normalizedParts[0];
    if (single.kind === 'TRADITIONAL') return 'Caixa Tradicional';
    return `Caixa de ${single.productName}`;
  }

  if (normalizedParts.length === 1 && normalizedParts[0]) {
    return `Caixa de ${normalizedParts[0].productName}`;
  }

  return 'Monte Sua Caixa';
}

export function deriveFlavorUnitsFromBoxCounts(boxCounts: Record<OrderBoxCode, number>) {
  const result: Record<OrderFlavorCode, number> = { T: 0, G: 0, D: 0, Q: 0, R: 0, RJ: 0 };
  for (const code of Object.keys(ORDER_BOX_CATALOG) as OrderBoxCode[]) {
    const count = boxCounts[code] || 0;
    if (count <= 0) continue;
    const unitMap = ORDER_BOX_CATALOG[code].units;
    result.T += unitMap.T * count;
    result.G += unitMap.G * count;
    result.D += unitMap.D * count;
    result.Q += unitMap.Q * count;
    result.R += unitMap.R * count;
    result.RJ += unitMap.RJ * count;
  }
  return result;
}

export function sumOrderFlavorCounts(counts: Record<OrderFlavorCode, number>) {
  return ORDER_FLAVOR_CODES.reduce((sum, code) => sum + Math.max(Math.floor(counts[code] || 0), 0), 0);
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
    return moneyFromMinorUnits(Math.round((ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS / ORDER_BOX_UNITS) * openUnits));
  }

  const countTraditional = Math.max(Math.floor(flavorCounts.T || 0), 0);
  const countGoiabada = Math.max(Math.floor(flavorCounts.G || 0), 0);
  const countDoce = Math.max(Math.floor(flavorCounts.D || 0), 0);
  const countQueijo = Math.max(Math.floor(flavorCounts.Q || 0), 0);
  const countRequeijao = Math.max(Math.floor(flavorCounts.R || 0), 0);
  const countRomeuEJulieta = Math.max(Math.floor(flavorCounts.RJ || 0), 0);

  const goiabadaTriplets = Math.floor(countGoiabada / 3);
  const otherTriplets =
    Math.floor(countDoce / 3) +
    Math.floor(countQueijo / 3) +
    Math.floor(countRequeijao / 3) +
    Math.floor(countRomeuEJulieta / 3);

  const discountTraditional = ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS - ORDER_BOX_PRICE_TRADITIONAL_MINOR_UNITS;
  const discountMixedGoiabada =
    ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS - ORDER_BOX_PRICE_MIXED_GOIABADA_MINOR_UNITS;
  const discountMixedOther = ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS - ORDER_BOX_PRICE_MIXED_OTHER_MINOR_UNITS;
  const discountGoiabada = ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS - ORDER_BOX_PRICE_GOIABADA_MINOR_UNITS;

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

  const fullBoxesSubtotal = fullBoxes * ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS - bestDiscount;
  const openSubtotal = openUnits > 0 ? Math.round((ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS / ORDER_BOX_UNITS) * openUnits) : 0;

  return moneyFromMinorUnits(fullBoxesSubtotal + openSubtotal);
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
    R: 0,
    RJ: 0
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
