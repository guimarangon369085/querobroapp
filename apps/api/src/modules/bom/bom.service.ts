import { BadRequestException, Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { parseLocaleNumber } from '../../common/normalize.js';
import { parseWithSchema } from '../../common/validation.js';
import { z } from 'zod';

const nullableNonNegativeNumberInputSchema = z.preprocess((value) => {
  if (value == null || value === '') return null;
  const parsed = parseLocaleNumber(value as string | number | null | undefined);
  return parsed === null ? value : parsed;
}, z.number().nonnegative().nullable());

const bomItemInputSchema = z.object({
  itemId: z.coerce.number().int().positive(),
  qtyPerRecipe: nullableNonNegativeNumberInputSchema.optional(),
  qtyPerSaleUnit: nullableNonNegativeNumberInputSchema.optional(),
  qtyPerUnit: nullableNonNegativeNumberInputSchema.optional()
});

const optionalNullableLabelSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}, z.string().min(1).nullable().optional());

const bomPayloadSchema = z.object({
  productId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1),
  saleUnitLabel: optionalNullableLabelSchema,
  yieldUnits: nullableNonNegativeNumberInputSchema.optional(),
  items: z.array(bomItemInputSchema).optional().default([])
});

type BroaItemPreset = {
  name: string;
  category: 'INGREDIENTE' | 'EMBALAGEM_EXTERNA' | 'EMBALAGEM_INTERNA';
  unit: string;
  purchasePackSize: number;
  purchasePackCost: number;
  qtyPerRecipe: number;
  qtyPerSaleUnit: number;
  qtyPerUnit: number;
};

type BroaFlavorPreset = {
  code: 'T' | 'G' | 'Q' | 'R' | 'D';
  productName: string;
  fillingItemName: string | null;
  legacyNames?: string[];
};

const BROA_SALE_UNIT_LABEL = 'Caixa com 7 broas';
const BROA_YIELD_UNITS = 12;

const BROA_ITEM_PRESETS: BroaItemPreset[] = [
  {
    name: 'FARINHA DE TRIGO',
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: 1000,
    purchasePackCost: 6.49,
    qtyPerRecipe: 60,
    qtyPerSaleUnit: 35,
    qtyPerUnit: 5
  },
  {
    name: 'FUBÁ DE CANJICA',
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: 1000,
    purchasePackCost: 6,
    qtyPerRecipe: 60,
    qtyPerSaleUnit: 35,
    qtyPerUnit: 5
  },
  {
    name: 'AÇÚCAR',
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: 1000,
    purchasePackCost: 5.69,
    qtyPerRecipe: 60,
    qtyPerSaleUnit: 35,
    qtyPerUnit: 5
  },
  {
    name: 'MANTEIGA',
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: 200,
    purchasePackCost: 12.79,
    qtyPerRecipe: 75,
    qtyPerSaleUnit: 43.75,
    qtyPerUnit: 6.25
  },
  {
    name: 'LEITE',
    category: 'INGREDIENTE',
    unit: 'ml',
    purchasePackSize: 1000,
    purchasePackCost: 4.19,
    qtyPerRecipe: 60,
    qtyPerSaleUnit: 35,
    qtyPerUnit: 5
  },
  {
    name: 'OVOS',
    category: 'INGREDIENTE',
    unit: 'uni',
    purchasePackSize: 20,
    purchasePackCost: 23.9,
    qtyPerRecipe: 3,
    qtyPerSaleUnit: 1.75,
    qtyPerUnit: 0.25
  },
  {
    name: 'GOIABADA',
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: 300,
    purchasePackCost: 5.99,
    qtyPerRecipe: 60,
    qtyPerSaleUnit: 35,
    qtyPerUnit: 5
  },
  {
    name: 'DOCE DE LEITE',
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: 200,
    purchasePackCost: 20.99,
    qtyPerRecipe: 96,
    qtyPerSaleUnit: 56,
    qtyPerUnit: 8
  },
  {
    name: 'QUEIJO DO SERRO',
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: 500,
    purchasePackCost: 46.95,
    qtyPerRecipe: 60,
    qtyPerSaleUnit: 35,
    qtyPerUnit: 5
  },
  {
    name: 'REQUEIJÃO DE CORTE',
    category: 'INGREDIENTE',
    unit: 'g',
    purchasePackSize: 240,
    purchasePackCost: 30.9,
    qtyPerRecipe: 60,
    qtyPerSaleUnit: 35,
    qtyPerUnit: 5
  },
  {
    name: 'SACOLA',
    category: 'EMBALAGEM_EXTERNA',
    unit: 'uni',
    purchasePackSize: 10,
    purchasePackCost: 17.88,
    qtyPerRecipe: 1.7,
    qtyPerSaleUnit: 1,
    qtyPerUnit: 0.14
  },
  {
    name: 'CAIXA DE PLÁSTICO',
    category: 'EMBALAGEM_INTERNA',
    unit: 'uni',
    purchasePackSize: 100,
    purchasePackCost: 86.65,
    qtyPerRecipe: 1.7,
    qtyPerSaleUnit: 1,
    qtyPerUnit: 0.14
  },
  {
    name: 'PAPEL MANTEIGA',
    category: 'EMBALAGEM_INTERNA',
    unit: 'cm',
    purchasePackSize: 7000,
    purchasePackCost: 10.29,
    qtyPerRecipe: 27.4,
    qtyPerSaleUnit: 16,
    qtyPerUnit: 2.29
  }
];

const BROA_FLAVOR_PRESETS: BroaFlavorPreset[] = [
  { code: 'T', productName: 'Broa Tradicional (T)', fillingItemName: null },
  { code: 'G', productName: 'Broa Goiabada (G)', fillingItemName: 'GOIABADA' },
  {
    code: 'Q',
    productName: 'Broa Queijo do Serro (Q)',
    fillingItemName: 'QUEIJO DO SERRO',
    legacyNames: ['Broa Queijo do Serro (S)']
  },
  { code: 'R', productName: 'Broa Requeijão de corte (R)', fillingItemName: 'REQUEIJÃO DE CORTE' },
  { code: 'D', productName: 'Broa Doce de leite (D)', fillingItemName: 'DOCE DE LEITE' }
];

@Injectable()
export class BomService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private normalizeLookup(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  list() {
    return this.prisma.bom.findMany({
      include: { items: { include: { item: true } }, product: true },
      orderBy: { id: 'asc' }
    });
  }

  async get(id: number) {
    const bom = await this.prisma.bom.findUnique({
      where: { id },
      include: { items: { include: { item: true } }, product: true }
    });
    if (!bom) throw new NotFoundException('BOM nao encontrado');
    return bom;
  }

  async create(payload: unknown) {
    const data = parseWithSchema(bomPayloadSchema, payload);
    const items = data.items ?? [];

    return this.prisma.bom.create({
      data: {
        productId: data.productId,
        name: data.name,
        saleUnitLabel: data.saleUnitLabel ?? null,
        yieldUnits: data.yieldUnits ?? null,
        items: {
          create: items.map((item) => ({
            itemId: item.itemId,
            qtyPerRecipe: item.qtyPerRecipe ?? null,
            qtyPerSaleUnit: item.qtyPerSaleUnit ?? null,
            qtyPerUnit: item.qtyPerUnit ?? null
          }))
        }
      },
      include: { items: true, product: true }
    });
  }

  async update(id: number, payload: unknown) {
    const data = parseWithSchema(bomPayloadSchema, payload);
    const items = data.items ?? [];

    return this.prisma.$transaction(async (tx) => {
      await tx.bom.update({
        where: { id },
        data: {
          productId: data.productId,
          name: data.name,
          saleUnitLabel: data.saleUnitLabel ?? null,
          yieldUnits: data.yieldUnits ?? null
        }
      });

      await tx.bomItem.deleteMany({ where: { bomId: id } });
      if (items.length > 0) {
        await tx.bomItem.createMany({
          data: items.map((item) => ({
            bomId: id,
            itemId: item.itemId,
            qtyPerRecipe: item.qtyPerRecipe ?? null,
            qtyPerSaleUnit: item.qtyPerSaleUnit ?? null,
            qtyPerUnit: item.qtyPerUnit ?? null
          }))
        });
      }

      return tx.bom.findUnique({
        where: { id },
        include: { items: { include: { item: true } }, product: true }
      });
    });
  }

  async bootstrapBroaPreset() {
    const existingInventory = await this.prisma.inventoryItem.findMany({ orderBy: { id: 'asc' } });
    const inventoryByName = new Map(existingInventory.map((item) => [this.normalizeLookup(item.name), item]));
    const itemIdByName = new Map<string, number>();

    let createdItems = 0;
    let updatedItems = 0;

    for (const preset of BROA_ITEM_PRESETS) {
      const key = this.normalizeLookup(preset.name);
      const current = inventoryByName.get(key);

      if (!current) {
        const created = await this.prisma.inventoryItem.create({
          data: {
            name: preset.name,
            category: preset.category,
            unit: preset.unit,
            purchasePackSize: preset.purchasePackSize,
            purchasePackCost: preset.purchasePackCost
          }
        });
        createdItems += 1;
        itemIdByName.set(preset.name, created.id);
        continue;
      }

      await this.prisma.inventoryItem.update({
        where: { id: current.id },
        data: {
          name: preset.name,
          category: preset.category,
          unit: preset.unit,
          purchasePackSize: preset.purchasePackSize,
          purchasePackCost: preset.purchasePackCost
        }
      });
      updatedItems += 1;
      itemIdByName.set(preset.name, current.id);
    }

    const flavorPriceMap: Record<BroaFlavorPreset['code'], number> = {
      T: 40,
      G: 50,
      Q: 52,
      R: 52,
      D: 52
    };

    let createdProducts = 0;
    let updatedBoms = 0;
    let createdBoms = 0;

    const baseItemNames = [
      'FARINHA DE TRIGO',
      'FUBÁ DE CANJICA',
      'AÇÚCAR',
      'MANTEIGA',
      'LEITE',
      'OVOS',
      'SACOLA',
      'CAIXA DE PLÁSTICO',
      'PAPEL MANTEIGA'
    ];

    for (const flavor of BROA_FLAVOR_PRESETS) {
      let product = await this.prisma.product.findFirst({
        where: { name: { in: [flavor.productName, ...(flavor.legacyNames || [])] } }
      });

      if (!product) {
        product = await this.prisma.product.create({
          data: {
            name: flavor.productName,
            category: 'Sabores',
            unit: 'cx',
            price: flavorPriceMap[flavor.code],
            active: true
          }
        });
        createdProducts += 1;
      } else if (product.name !== flavor.productName) {
        product = await this.prisma.product.update({
          where: { id: product.id },
          data: {
            name: flavor.productName
          }
        });
      }

      product = await this.prisma.product.update({
        where: { id: product.id },
        data: {
          category: 'Sabores',
          unit: 'cx',
          price: flavorPriceMap[flavor.code],
          active: true
        }
      });

      const bomItemsPreset = [...baseItemNames];
      if (flavor.fillingItemName) {
        bomItemsPreset.push(flavor.fillingItemName);
      }

      const bomItems = bomItemsPreset.map((itemName) => {
        const preset = BROA_ITEM_PRESETS.find((entry) => entry.name === itemName);
        if (!preset) {
          throw new BadRequestException(`Preset de item "${itemName}" nao encontrado.`);
        }
        const itemId = itemIdByName.get(itemName);
        if (!itemId) {
          throw new BadRequestException(`Item "${itemName}" nao encontrado no estoque.`);
        }
        return {
          itemId,
          qtyPerRecipe: preset.qtyPerRecipe,
          qtyPerSaleUnit: preset.qtyPerSaleUnit,
          qtyPerUnit: preset.qtyPerUnit
        };
      });

      const existingBom = await this.prisma.bom.findFirst({
        where: { productId: product.id },
        orderBy: { id: 'asc' }
      });

      if (!existingBom) {
        await this.prisma.bom.create({
          data: {
            productId: product.id,
            name: flavor.productName,
            saleUnitLabel: BROA_SALE_UNIT_LABEL,
            yieldUnits: BROA_YIELD_UNITS,
            items: {
              create: bomItems
            }
          }
        });
        createdBoms += 1;
        continue;
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.bom.update({
          where: { id: existingBom.id },
          data: {
            name: flavor.productName,
            saleUnitLabel: BROA_SALE_UNIT_LABEL,
            yieldUnits: BROA_YIELD_UNITS
          }
        });
        await tx.bomItem.deleteMany({ where: { bomId: existingBom.id } });
        await tx.bomItem.createMany({
          data: bomItems.map((item) => ({
            bomId: existingBom.id,
            itemId: item.itemId,
            qtyPerRecipe: item.qtyPerRecipe,
            qtyPerSaleUnit: item.qtyPerSaleUnit,
            qtyPerUnit: item.qtyPerUnit
          }))
        });
      });
      updatedBoms += 1;
    }

    return {
      createdItems,
      updatedItems,
      createdProducts,
      createdBoms,
      updatedBoms
    };
  }

  listFlavorCombinations(totalUnits = 7) {
    const units = Number(totalUnits);
    if (!Number.isFinite(units) || units <= 0 || units > 30) {
      throw new BadRequestException('Total de unidades invalido. Use um numero entre 1 e 30.');
    }

    const flavors: Array<'T' | 'G' | 'Q' | 'R' | 'D'> = ['T', 'G', 'Q', 'R', 'D'];
    const combos: Array<{
      code: string;
      composition: string;
      slots: string[];
      T: number;
      G: number;
      Q: number;
      R: number;
      D: number;
    }> = [];

    const walk = (index: number, remaining: number, counts: Record<'T' | 'G' | 'Q' | 'R' | 'D', number>) => {
      if (index === flavors.length - 1) {
        counts[flavors[index]] = remaining;
        const slots = flavors.flatMap((flavor) => Array.from({ length: counts[flavor] }, () => flavor));
        const parts = flavors.filter((flavor) => counts[flavor] > 0).map((flavor) => `${counts[flavor]}${flavor}`);
        const singleFlavor = parts.length === 1 && parts[0].startsWith(`${units}`);
        combos.push({
          code: singleFlavor ? parts[0].replace(String(units), '') : `S-${parts.join('')}`,
          composition: `${counts.T}T + ${counts.G}G + ${counts.Q}Q + ${counts.R}R + ${counts.D}D`,
          slots,
          T: counts.T,
          G: counts.G,
          Q: counts.Q,
          R: counts.R,
          D: counts.D
        });
        return;
      }

      for (let value = remaining; value >= 0; value -= 1) {
        counts[flavors[index]] = value;
        walk(index + 1, remaining - value, counts);
      }
    };

    walk(0, units, { T: 0, G: 0, Q: 0, R: 0, D: 0 });

    return {
      totalUnits: units,
      totalCombinations: combos.length,
      combinations: combos
    };
  }

  async remove(id: number) {
    await this.get(id);
    await this.prisma.bom.delete({ where: { id } });
  }
}
