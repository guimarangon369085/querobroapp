export const MASS_READY_ITEM_NAME = 'MASSA PRONTA';
export const ORDER_BOX_UNITS = 7;
export const ORDER_PAPER_BAG_BOX_CAPACITY = 2;
export const ORDER_PAPER_MANTEIGA_CM_PER_BOX = 16;
export const OVEN_CAPACITY_BROAS = 14;
export const OFFICIAL_BROA_RECIPE_YIELD_UNITS = 36;
export const OFFICIAL_BROA_RECIPE_MILK_ML = 480;
export const OFFICIAL_BROA_RECIPE_WATER_ML = 480;
export const OFFICIAL_BROA_RECIPE_BUTTER_G = 300;
export const OFFICIAL_BROA_RECIPE_SUGAR_G = 240;
export const OFFICIAL_BROA_RECIPE_WHEAT_FLOUR_G = 260;
export const OFFICIAL_BROA_RECIPE_CANJICA_FUBA_G = 260;
export const OFFICIAL_BROA_RECIPE_EGGS_UNITS = 12;
export const OFFICIAL_BROA_FILLING_QTY_PER_UNIT = 8;
export const MASS_READY_BROAS_PER_RECIPE = OFFICIAL_BROA_RECIPE_YIELD_UNITS;
export const MASS_PREP_DEFAULT_BATCH_RECIPES = 2;

const DEFAULT_PURCHASE_PACKS = {
  MILK: { size: 1000, cost: 5.49 },
  BUTTER: { size: 200, cost: 12.79 },
  SUGAR: { size: 1000, cost: 4.59 },
  FLOUR: { size: 1000, cost: 6.49 },
  CANJICA_FUBA: { size: 1000, cost: 11.99 },
  EGGS: { size: 20, cost: 23.9 },
  GOIABADA: { size: 300, cost: 5.99 },
  DOCE_DE_LEITE: { size: 200, cost: 20.99 },
  QUEIJO_DO_SERRO: { size: 500, cost: 46.95 },
  REQUEIJAO_DE_CORTE: { size: 240, cost: 30.9 },
  PAPER_BAG: { size: 10, cost: 17.88 },
  PLASTIC_BOX: { size: 100, cost: 86.65 },
  BUTTER_PAPER: { size: 750, cost: 7.87 }
} as const;

export const OFFICIAL_BROA_FLAVOR_CODES = ['T', 'G', 'D', 'Q', 'R'] as const;
export type OfficialBroaFlavorCode = (typeof OFFICIAL_BROA_FLAVOR_CODES)[number];

export type InventoryCategory =
  | 'INGREDIENTE'
  | 'EMBALAGEM_INTERNA'
  | 'EMBALAGEM_EXTERNA';

export type InventoryAliasDefinition = {
  canonicalName: string;
  aliases: readonly string[];
  category: InventoryCategory;
  unit: string;
  purchasePackSize: number;
  purchasePackCost: number;
  qtyPerRecipe?: number;
  qtyPerUnit?: number;
};

export type InventoryRecipeDefinition = InventoryAliasDefinition & {
  qtyPerRecipe: number;
};

export type BroaPackagingPlan = {
  plasticBoxes: number;
  paperBags: number;
  paperButterCm: number;
};

export type InventoryLookupMap<T extends { name: string }> = Map<string, T[]>;

export function normalizeInventoryLookup(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function buildInventoryItemLookup<T extends { name: string }>(
  items: T[]
): InventoryLookupMap<T> {
  const byName: InventoryLookupMap<T> = new Map();
  for (const item of items) {
    const key = normalizeInventoryLookup(item.name);
    const current = byName.get(key) || [];
    current.push(item);
    byName.set(key, current);
  }
  return byName;
}

export function addInventoryLookupItem<T extends { name: string }>(
  byName: InventoryLookupMap<T>,
  item: T
) {
  const key = normalizeInventoryLookup(item.name);
  const current = byName.get(key) || [];
  current.push(item);
  byName.set(key, current);
}

export function findInventoryByAliases<T extends { name: string }>(
  byName: InventoryLookupMap<T>,
  params: {
    canonicalName: string;
    aliases: readonly string[];
  }
) {
  const orderedNames = [params.canonicalName, ...params.aliases].filter(
    (value, index, values) =>
      values.findIndex((entry) => normalizeInventoryLookup(entry) === normalizeInventoryLookup(value)) === index
  );

  for (const name of orderedNames) {
    const candidates = byName.get(normalizeInventoryLookup(name));
    if (candidates && candidates.length > 0) {
      return candidates[0];
    }
  }

  return null;
}

export const canonicalInventoryItemDefinitions = [
  {
    canonicalName: 'LEITE',
    aliases: ['LEITE'],
    category: 'INGREDIENTE',
    unit: 'ml',
    qtyPerRecipe: OFFICIAL_BROA_RECIPE_MILK_ML,
    purchasePackSize: DEFAULT_PURCHASE_PACKS.MILK.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.MILK.cost
  },
  {
    canonicalName: 'MANTEIGA',
    aliases: ['MANTEIGA', 'MANTEIGA COM SAL'],
    category: 'INGREDIENTE',
    unit: 'g',
    qtyPerRecipe: OFFICIAL_BROA_RECIPE_BUTTER_G,
    purchasePackSize: DEFAULT_PURCHASE_PACKS.BUTTER.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.BUTTER.cost
  },
  {
    canonicalName: 'AÇÚCAR',
    aliases: ['AÇÚCAR', 'ACUCAR'],
    category: 'INGREDIENTE',
    unit: 'g',
    qtyPerRecipe: OFFICIAL_BROA_RECIPE_SUGAR_G,
    purchasePackSize: DEFAULT_PURCHASE_PACKS.SUGAR.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.SUGAR.cost
  },
  {
    canonicalName: 'FARINHA DE TRIGO',
    aliases: ['FARINHA DE TRIGO'],
    category: 'INGREDIENTE',
    unit: 'g',
    qtyPerRecipe: OFFICIAL_BROA_RECIPE_WHEAT_FLOUR_G,
    purchasePackSize: DEFAULT_PURCHASE_PACKS.FLOUR.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.FLOUR.cost
  },
  {
    canonicalName: 'FUBÁ DE CANJICA',
    aliases: ['FUBÁ DE CANJICA', 'FUBA DE CANJICA'],
    category: 'INGREDIENTE',
    unit: 'g',
    qtyPerRecipe: OFFICIAL_BROA_RECIPE_CANJICA_FUBA_G,
    purchasePackSize: DEFAULT_PURCHASE_PACKS.CANJICA_FUBA.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.CANJICA_FUBA.cost
  },
  {
    canonicalName: 'OVOS',
    aliases: ['OVOS'],
    category: 'INGREDIENTE',
    unit: 'uni',
    qtyPerRecipe: OFFICIAL_BROA_RECIPE_EGGS_UNITS,
    purchasePackSize: DEFAULT_PURCHASE_PACKS.EGGS.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.EGGS.cost
  },
  {
    canonicalName: 'GOIABADA',
    aliases: ['GOIABADA'],
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: DEFAULT_PURCHASE_PACKS.GOIABADA.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.GOIABADA.cost,
    qtyPerUnit: 5
  },
  {
    canonicalName: 'DOCE DE LEITE',
    aliases: ['DOCE DE LEITE'],
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: DEFAULT_PURCHASE_PACKS.DOCE_DE_LEITE.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.DOCE_DE_LEITE.cost,
    qtyPerUnit: 5
  },
  {
    canonicalName: 'QUEIJO DO SERRO',
    aliases: ['QUEIJO DO SERRO', 'QUEIJO'],
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: DEFAULT_PURCHASE_PACKS.QUEIJO_DO_SERRO.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.QUEIJO_DO_SERRO.cost,
    qtyPerUnit: 5
  },
  {
    canonicalName: 'REQUEIJÃO DE CORTE',
    aliases: ['REQUEIJÃO DE CORTE', 'REQUEIJAO DE CORTE'],
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: DEFAULT_PURCHASE_PACKS.REQUEIJAO_DE_CORTE.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.REQUEIJAO_DE_CORTE.cost,
    qtyPerUnit: 5
  },
  {
    canonicalName: 'SACOLA',
    aliases: ['SACOLA'],
    category: 'EMBALAGEM_EXTERNA',
    unit: 'uni',
    purchasePackSize: DEFAULT_PURCHASE_PACKS.PAPER_BAG.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.PAPER_BAG.cost
  },
  {
    canonicalName: 'CAIXA DE PLÁSTICO',
    aliases: ['CAIXA DE PLÁSTICO', 'CAIXA DE PLASTICO'],
    category: 'EMBALAGEM_INTERNA',
    unit: 'uni',
    purchasePackSize: DEFAULT_PURCHASE_PACKS.PLASTIC_BOX.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.PLASTIC_BOX.cost
  },
  {
    canonicalName: 'PAPEL MANTEIGA',
    aliases: ['PAPEL MANTEIGA'],
    category: 'EMBALAGEM_INTERNA',
    unit: 'cm',
    purchasePackSize: DEFAULT_PURCHASE_PACKS.BUTTER_PAPER.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.BUTTER_PAPER.cost
  },
  {
    canonicalName: MASS_READY_ITEM_NAME,
    aliases: [MASS_READY_ITEM_NAME],
    category: 'INGREDIENTE',
    unit: 'receita',
    purchasePackSize: 1,
    purchasePackCost: 0
  }
] as const satisfies readonly InventoryAliasDefinition[];

export const massPrepRecipeIngredients = [
  {
    canonicalName: 'LEITE',
    aliases: ['LEITE'],
    category: 'INGREDIENTE',
    unit: 'ml',
    qtyPerRecipe: OFFICIAL_BROA_RECIPE_MILK_ML,
    purchasePackSize: DEFAULT_PURCHASE_PACKS.MILK.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.MILK.cost
  },
  {
    canonicalName: 'MANTEIGA',
    aliases: ['MANTEIGA', 'MANTEIGA COM SAL'],
    category: 'INGREDIENTE',
    unit: 'g',
    qtyPerRecipe: OFFICIAL_BROA_RECIPE_BUTTER_G,
    purchasePackSize: DEFAULT_PURCHASE_PACKS.BUTTER.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.BUTTER.cost
  },
  {
    canonicalName: 'AÇÚCAR',
    aliases: ['AÇÚCAR', 'ACUCAR'],
    category: 'INGREDIENTE',
    unit: 'g',
    qtyPerRecipe: OFFICIAL_BROA_RECIPE_SUGAR_G,
    purchasePackSize: DEFAULT_PURCHASE_PACKS.SUGAR.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.SUGAR.cost
  },
  {
    canonicalName: 'FARINHA DE TRIGO',
    aliases: ['FARINHA DE TRIGO'],
    category: 'INGREDIENTE',
    unit: 'g',
    qtyPerRecipe: OFFICIAL_BROA_RECIPE_WHEAT_FLOUR_G,
    purchasePackSize: DEFAULT_PURCHASE_PACKS.FLOUR.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.FLOUR.cost
  },
  {
    canonicalName: 'FUBÁ DE CANJICA',
    aliases: ['FUBÁ DE CANJICA', 'FUBA DE CANJICA'],
    category: 'INGREDIENTE',
    unit: 'g',
    qtyPerRecipe: OFFICIAL_BROA_RECIPE_CANJICA_FUBA_G,
    purchasePackSize: DEFAULT_PURCHASE_PACKS.CANJICA_FUBA.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.CANJICA_FUBA.cost
  },
  {
    canonicalName: 'OVOS',
    aliases: ['OVOS'],
    category: 'INGREDIENTE',
    unit: 'uni',
    qtyPerRecipe: OFFICIAL_BROA_RECIPE_EGGS_UNITS,
    purchasePackSize: DEFAULT_PURCHASE_PACKS.EGGS.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.EGGS.cost
  }
] as const satisfies readonly InventoryRecipeDefinition[];

export const orderFillingIngredientsByFlavorCode = {
  G: {
    canonicalName: 'GOIABADA',
    aliases: ['GOIABADA'],
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: DEFAULT_PURCHASE_PACKS.GOIABADA.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.GOIABADA.cost,
    qtyPerUnit: OFFICIAL_BROA_FILLING_QTY_PER_UNIT
  },
  D: {
    canonicalName: 'DOCE DE LEITE',
    aliases: ['DOCE DE LEITE'],
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: DEFAULT_PURCHASE_PACKS.DOCE_DE_LEITE.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.DOCE_DE_LEITE.cost,
    qtyPerUnit: OFFICIAL_BROA_FILLING_QTY_PER_UNIT
  },
  Q: {
    canonicalName: 'QUEIJO DO SERRO',
    aliases: ['QUEIJO DO SERRO', 'QUEIJO'],
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: DEFAULT_PURCHASE_PACKS.QUEIJO_DO_SERRO.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.QUEIJO_DO_SERRO.cost,
    qtyPerUnit: OFFICIAL_BROA_FILLING_QTY_PER_UNIT
  },
  R: {
    canonicalName: 'REQUEIJÃO DE CORTE',
    aliases: ['REQUEIJÃO DE CORTE', 'REQUEIJAO DE CORTE'],
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: DEFAULT_PURCHASE_PACKS.REQUEIJAO_DE_CORTE.size,
    purchasePackCost: DEFAULT_PURCHASE_PACKS.REQUEIJAO_DE_CORTE.cost,
    qtyPerUnit: OFFICIAL_BROA_FILLING_QTY_PER_UNIT
  }
} as const satisfies Record<string, InventoryAliasDefinition>;

const canonicalDefinitionByLookup = new Map<string, InventoryAliasDefinition>();
for (const definition of canonicalInventoryItemDefinitions) {
  for (const alias of [definition.canonicalName, ...definition.aliases]) {
    canonicalDefinitionByLookup.set(normalizeInventoryLookup(alias), definition);
  }
}

export function resolveInventoryDefinition(value?: string | null) {
  if (!value) return null;
  return canonicalDefinitionByLookup.get(normalizeInventoryLookup(value)) || null;
}

export function resolveInventoryFamilyKey(value?: string | null) {
  if (!value) return '';
  const definition = resolveInventoryDefinition(value);
  if (definition) {
    return normalizeInventoryLookup(definition.canonicalName);
  }
  return normalizeInventoryLookup(value);
}

export function resolveInventoryDisplayName(value?: string | null) {
  if (!value) return '';
  const definition = resolveInventoryDefinition(value);
  return definition?.canonicalName || value;
}

export function resolveOfficialBroaFlavorCodeFromProductName(
  value?: string | null
): OfficialBroaFlavorCode | null {
  const normalized = (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('tradicional')) return 'T';
  if (normalized.includes('goiabada')) return 'G';
  if (normalized.includes('doce')) return 'D';
  if (normalized.includes('queijo') && !normalized.includes('requeij')) return 'Q';
  if (normalized.includes('requeij')) return 'R';
  return null;
}

export function emptyOfficialBroaFlavorCounts(): Record<OfficialBroaFlavorCode, number> {
  return { T: 0, G: 0, D: 0, Q: 0, R: 0 };
}

export function buildOfficialBroaFlavorSummary(
  items: Array<{ productId: number; quantity: number }>,
  productNameById: Map<number, string>
) {
  const flavorCounts = emptyOfficialBroaFlavorCounts();
  let totalBroas = 0;

  for (const item of items) {
    const quantity = Math.max(Math.floor(item.quantity || 0), 0);
    if (quantity <= 0) continue;
    const flavorCode = resolveOfficialBroaFlavorCodeFromProductName(productNameById.get(item.productId));
    if (!flavorCode) continue;
    flavorCounts[flavorCode] += quantity;
    totalBroas += quantity;
  }

  return { totalBroas, flavorCounts };
}

export function computeBroaPaperBagCount(totalPlasticBoxes: number) {
  const normalizedBoxes = Math.max(Math.floor(totalPlasticBoxes || 0), 0);
  return normalizedBoxes > 0 ? Math.ceil(normalizedBoxes / ORDER_PAPER_BAG_BOX_CAPACITY) : 0;
}

export function computeBroaPackagingPlan(totalBroas: number): BroaPackagingPlan {
  const normalizedBroas = Math.max(Math.floor(totalBroas || 0), 0);
  const plasticBoxes = normalizedBroas > 0 ? Math.ceil(normalizedBroas / ORDER_BOX_UNITS) : 0;
  const paperBags = computeBroaPaperBagCount(plasticBoxes);
  const paperButterCm = plasticBoxes * ORDER_PAPER_MANTEIGA_CM_PER_BOX;

  return {
    plasticBoxes,
    paperBags,
    paperButterCm
  };
}

export function resolvePlannedMassPrepRecipes(
  requiredRecipes: number,
  maxRecipesFromIngredients = Number.POSITIVE_INFINITY,
  requestedRecipes = MASS_PREP_DEFAULT_BATCH_RECIPES
) {
  if (!Number.isFinite(requiredRecipes) || requiredRecipes <= 0) return 0;

  const normalizedRequestedRecipes = Math.max(Math.floor(requestedRecipes || 0), 0);
  if (normalizedRequestedRecipes <= 0) return 0;

  const preferredRecipes = normalizedRequestedRecipes >= MASS_PREP_DEFAULT_BATCH_RECIPES
    ? MASS_PREP_DEFAULT_BATCH_RECIPES
    : 1;
  const normalizedMaxRecipesFromIngredients = Number.isFinite(maxRecipesFromIngredients)
    ? Math.max(Math.floor(maxRecipesFromIngredients || 0), 0)
    : 0;

  if (
    preferredRecipes >= MASS_PREP_DEFAULT_BATCH_RECIPES &&
    normalizedMaxRecipesFromIngredients >= MASS_PREP_DEFAULT_BATCH_RECIPES
  ) {
    return MASS_PREP_DEFAULT_BATCH_RECIPES;
  }

  return 1;
}

export function resolveExecutableMassPrepRecipes(
  requestedRecipes: number,
  maxRecipesFromIngredients: number
) {
  const normalizedRequestedRecipes = Math.max(Math.floor(requestedRecipes || 0), 0);
  const normalizedMaxRecipesFromIngredients = Number.isFinite(maxRecipesFromIngredients)
    ? Math.max(Math.floor(maxRecipesFromIngredients || 0), 0)
    : 0;

  if (normalizedRequestedRecipes >= MASS_PREP_DEFAULT_BATCH_RECIPES) {
    if (normalizedMaxRecipesFromIngredients >= MASS_PREP_DEFAULT_BATCH_RECIPES) {
      return MASS_PREP_DEFAULT_BATCH_RECIPES;
    }
    if (normalizedMaxRecipesFromIngredients >= 1) {
      return 1;
    }
    return 0;
  }

  if (normalizedRequestedRecipes >= 1 && normalizedMaxRecipesFromIngredients >= 1) {
    return 1;
  }

  return 0;
}

export function resolveInventoryFamilyItemIds<T extends { id: number; name: string }>(
  items: T[],
  params: {
    canonicalName: string;
    aliases: readonly string[];
  }
) {
  const lookupKeys = [params.canonicalName, ...params.aliases].map((value) =>
    normalizeInventoryLookup(value)
  );
  const idSet = new Set<number>();

  for (const item of items) {
    const itemKey = normalizeInventoryLookup(item.name);
    if (lookupKeys.includes(itemKey)) {
      idSet.add(item.id);
      continue;
    }

    if (resolveInventoryFamilyKey(item.name) === normalizeInventoryLookup(params.canonicalName)) {
      idSet.add(item.id);
    }
  }

  return Array.from(idSet.values());
}

export function pickInventoryFamilyRepresentative<T extends { name: string }>(
  items: T[],
  canonicalName: string
) {
  const canonicalKey = normalizeInventoryLookup(canonicalName);
  return (
    items.find((item) => normalizeInventoryLookup(item.name) === canonicalKey) ||
    items[0] ||
    null
  );
}

const massPrepIngredientLookups = new Set(
  massPrepRecipeIngredients.flatMap((ingredient) =>
    [ingredient.canonicalName, ...ingredient.aliases].map((value) => normalizeInventoryLookup(value))
  )
);

const orderFillingIngredientLookups = new Set(
  Object.values(orderFillingIngredientsByFlavorCode).flatMap((ingredient) =>
    [ingredient.canonicalName, ...ingredient.aliases].map((value) => normalizeInventoryLookup(value))
  )
);

const packagingIngredientLookups = new Set(
  ['SACOLA', 'CAIXA DE PLÁSTICO', 'CAIXA DE PLASTICO', 'PAPEL MANTEIGA'].map((value) =>
    normalizeInventoryLookup(value)
  )
);

export function isMassPrepIngredientName(value?: string | null) {
  if (!value) return false;
  return massPrepIngredientLookups.has(normalizeInventoryLookup(value));
}

export function isOrderFillingIngredientName(value?: string | null) {
  if (!value) return false;
  return orderFillingIngredientLookups.has(normalizeInventoryLookup(value));
}

export function isPackagingIngredientName(value?: string | null) {
  if (!value) return false;
  return packagingIngredientLookups.has(normalizeInventoryLookup(value));
}
