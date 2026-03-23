export const MASS_READY_ITEM_NAME = 'MASSA PRONTA';
export const MASS_READY_BROAS_PER_RECIPE = 21;
export const MASS_PREP_DEFAULT_BATCH_RECIPES = 2;
export const ORDER_BOX_UNITS = 7;
export const ORDER_PAPER_BAG_BOX_CAPACITY = 2;
export const ORDER_PAPER_MANTEIGA_CM_PER_BOX = 16;
export const OVEN_CAPACITY_BROAS = 14;

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
    qtyPerRecipe: 240,
    purchasePackSize: 1000,
    purchasePackCost: 4.19
  },
  {
    canonicalName: 'MANTEIGA',
    aliases: ['MANTEIGA', 'MANTEIGA COM SAL'],
    category: 'INGREDIENTE',
    unit: 'g',
    qtyPerRecipe: 150,
    purchasePackSize: 500,
    purchasePackCost: 24.9
  },
  {
    canonicalName: 'AÇÚCAR',
    aliases: ['AÇÚCAR', 'ACUCAR'],
    category: 'INGREDIENTE',
    unit: 'g',
    qtyPerRecipe: 120,
    purchasePackSize: 1000,
    purchasePackCost: 5.69
  },
  {
    canonicalName: 'FARINHA DE TRIGO',
    aliases: ['FARINHA DE TRIGO'],
    category: 'INGREDIENTE',
    unit: 'g',
    qtyPerRecipe: 130,
    purchasePackSize: 1000,
    purchasePackCost: 6.49
  },
  {
    canonicalName: 'FUBÁ DE CANJICA',
    aliases: ['FUBÁ DE CANJICA', 'FUBA DE CANJICA'],
    category: 'INGREDIENTE',
    unit: 'g',
    qtyPerRecipe: 130,
    purchasePackSize: 1000,
    purchasePackCost: 6
  },
  {
    canonicalName: 'OVOS',
    aliases: ['OVOS'],
    category: 'INGREDIENTE',
    unit: 'uni',
    qtyPerRecipe: 6,
    purchasePackSize: 20,
    purchasePackCost: 23.9
  },
  {
    canonicalName: 'GOIABADA',
    aliases: ['GOIABADA'],
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: 1000,
    purchasePackCost: 19,
    qtyPerUnit: 5
  },
  {
    canonicalName: 'DOCE DE LEITE',
    aliases: ['DOCE DE LEITE'],
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: 1000,
    purchasePackCost: 24,
    qtyPerUnit: 5
  },
  {
    canonicalName: 'QUEIJO DO SERRO',
    aliases: ['QUEIJO DO SERRO', 'QUEIJO'],
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: 1000,
    purchasePackCost: 35,
    qtyPerUnit: 5
  },
  {
    canonicalName: 'REQUEIJÃO DE CORTE',
    aliases: ['REQUEIJÃO DE CORTE', 'REQUEIJAO DE CORTE'],
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: 1000,
    purchasePackCost: 38,
    qtyPerUnit: 5
  },
  {
    canonicalName: 'SACOLA',
    aliases: ['SACOLA'],
    category: 'EMBALAGEM_EXTERNA',
    unit: 'uni',
    purchasePackSize: 10,
    purchasePackCost: 17.88
  },
  {
    canonicalName: 'CAIXA DE PLÁSTICO',
    aliases: ['CAIXA DE PLÁSTICO', 'CAIXA DE PLASTICO'],
    category: 'EMBALAGEM_INTERNA',
    unit: 'uni',
    purchasePackSize: 100,
    purchasePackCost: 86.65
  },
  {
    canonicalName: 'PAPEL MANTEIGA',
    aliases: ['PAPEL MANTEIGA'],
    category: 'EMBALAGEM_INTERNA',
    unit: 'cm',
    purchasePackSize: 7000,
    purchasePackCost: 10.29
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
    qtyPerRecipe: 240,
    purchasePackSize: 1000,
    purchasePackCost: 4.19
  },
  {
    canonicalName: 'MANTEIGA',
    aliases: ['MANTEIGA', 'MANTEIGA COM SAL'],
    category: 'INGREDIENTE',
    unit: 'g',
    qtyPerRecipe: 150,
    purchasePackSize: 500,
    purchasePackCost: 24.9
  },
  {
    canonicalName: 'AÇÚCAR',
    aliases: ['AÇÚCAR', 'ACUCAR'],
    category: 'INGREDIENTE',
    unit: 'g',
    qtyPerRecipe: 120,
    purchasePackSize: 1000,
    purchasePackCost: 5.69
  },
  {
    canonicalName: 'FARINHA DE TRIGO',
    aliases: ['FARINHA DE TRIGO'],
    category: 'INGREDIENTE',
    unit: 'g',
    qtyPerRecipe: 130,
    purchasePackSize: 1000,
    purchasePackCost: 6.49
  },
  {
    canonicalName: 'FUBÁ DE CANJICA',
    aliases: ['FUBÁ DE CANJICA', 'FUBA DE CANJICA'],
    category: 'INGREDIENTE',
    unit: 'g',
    qtyPerRecipe: 130,
    purchasePackSize: 1000,
    purchasePackCost: 6
  },
  {
    canonicalName: 'OVOS',
    aliases: ['OVOS'],
    category: 'INGREDIENTE',
    unit: 'uni',
    qtyPerRecipe: 6,
    purchasePackSize: 20,
    purchasePackCost: 23.9
  }
] as const satisfies readonly InventoryRecipeDefinition[];

export const orderFillingIngredientsByFlavorCode = {
  G: {
    canonicalName: 'GOIABADA',
    aliases: ['GOIABADA'],
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: 1000,
    purchasePackCost: 19,
    qtyPerUnit: 5
  },
  D: {
    canonicalName: 'DOCE DE LEITE',
    aliases: ['DOCE DE LEITE'],
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: 1000,
    purchasePackCost: 24,
    qtyPerUnit: 5
  },
  Q: {
    canonicalName: 'QUEIJO DO SERRO',
    aliases: ['QUEIJO DO SERRO', 'QUEIJO'],
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: 1000,
    purchasePackCost: 35,
    qtyPerUnit: 5
  },
  R: {
    canonicalName: 'REQUEIJÃO DE CORTE',
    aliases: ['REQUEIJÃO DE CORTE', 'REQUEIJAO DE CORTE'],
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: 1000,
    purchasePackCost: 38,
    qtyPerUnit: 5
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
