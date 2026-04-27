import { PrismaClient } from '@prisma/client';
import {
  MASS_READY_BROAS_PER_RECIPE,
  OFFICIAL_BROA_FILLING_QTY_PER_UNIT,
  OFFICIAL_BROA_RECIPE_BUTTER_G,
  OFFICIAL_BROA_RECIPE_CANJICA_FUBA_G,
  OFFICIAL_BROA_RECIPE_EGGS_UNITS,
  OFFICIAL_BROA_RECIPE_MILK_ML,
  OFFICIAL_BROA_RECIPE_SUGAR_G,
  OFFICIAL_BROA_RECIPE_WHEAT_FLOUR_G,
  ORDER_PAPER_BAG_BOX_CAPACITY,
  ORDER_BOX_UNITS,
  ORDER_PAPER_MANTEIGA_CM_PER_BOX
} from '../src/modules/inventory/inventory-formulas.js';

const prisma = new PrismaClient();
const OFFICIAL_BROA_BOXES_PER_RECIPE = MASS_READY_BROAS_PER_RECIPE / ORDER_BOX_UNITS;
const OFFICIAL_BROA_PAPER_BAGS_PER_RECIPE = OFFICIAL_BROA_BOXES_PER_RECIPE / ORDER_PAPER_BAG_BOX_CAPACITY;

type ProductSeed = {
  name: string;
  category: string;
  unit: string;
  price: number;
  active: boolean;
};

type InventorySeed = {
  name: string;
  category: 'INGREDIENTE' | 'EMBALAGEM_EXTERNA' | 'EMBALAGEM_INTERNA';
  unit: string;
  purchasePackSize: number;
  purchasePackCost: number;
};

type OrderSeedItem = {
  productName: string;
  quantity: number;
};

type OrderSeedPayment = {
  amount: number | 'TOTAL';
  method: string;
  daysAgo?: number;
};

type OrderSeed = {
  key: string;
  customerPhone: string;
  status: 'ABERTO' | 'PRONTO' | 'ENTREGUE' | 'CANCELADO';
  discount?: number;
  daysAgo?: number;
  items: OrderSeedItem[];
  payments?: OrderSeedPayment[];
};

function toMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseSaleUnits(label?: string | null) {
  if (!label) return 1;
  const match = label.match(/(\d+)/);
  return match ? Number(match[1]) : 1;
}

async function ensureCustomers() {
  const customersSeed = [
    {
      name: 'Cliente Exemplo',
      phone: '+55 11 98888-0000',
      address: 'Rua Exemplo, 123 - Sao Paulo/SP'
    },
    {
      name: 'Padaria Centro',
      phone: '+55 11 97777-0000',
      address: 'Av. Central, 450 - Sao Paulo/SP'
    },
    {
      name: 'Cafe da Praca',
      phone: '+55 11 96666-0000',
      address: 'Praca da Matriz, 88 - Sao Paulo/SP'
    }
  ];

  const map = new Map<string, { id: number; name: string }>();
  for (const customer of customersSeed) {
    const existing = await prisma.customer.findFirst({
      where: { phone: customer.phone }
    });
    const record =
      existing ??
      (await prisma.customer.create({
        data: customer
      }));
    map.set(customer.phone, { id: record.id, name: record.name });
  }
  return map;
}

async function ensureProducts() {
  const productsSeed: ProductSeed[] = [
    { name: 'Broa (Caixa c/7)', category: 'Broas', unit: 'cx', price: 25.0, active: true },
    { name: 'Broa Tradicional (T)', category: 'Sabores', unit: 'cx', price: 25.0, active: true },
    { name: 'Broa Goiabada (G)', category: 'Sabores', unit: 'cx', price: 26.0, active: true },
    { name: 'Broa Queijo do Serro (S)', category: 'Sabores', unit: 'cx', price: 27.0, active: true },
    { name: 'Broa Requeijao (R)', category: 'Sabores', unit: 'cx', price: 26.5, active: true },
    { name: 'Broa Doce de Leite (D)', category: 'Sabores', unit: 'cx', price: 27.5, active: true },
    { name: 'Cerveja IPA 500ml', category: 'Bebidas', unit: 'un', price: 12.5, active: true },
    { name: 'Refrigerante 350ml', category: 'Bebidas', unit: 'un', price: 6.0, active: true },
    { name: 'Hamburguer artesanal', category: 'Lanches', unit: 'un', price: 28.0, active: true }
  ];

  const productMap = new Map<string, { id: number; price: number }>();
  for (const product of productsSeed) {
    const existing = await prisma.product.findFirst({ where: { name: product.name } });
    const record =
      existing ??
      (await prisma.product.create({
        data: product
      }));
    productMap.set(product.name, { id: record.id, price: record.price });
  }

  return productMap;
}

async function ensureInventoryItems() {
  const inventoryItems: InventorySeed[] = [
    {
      name: 'Farinha de trigo',
      category: 'INGREDIENTE',
      unit: 'g',
      purchasePackSize: 1000,
      purchasePackCost: 0
    },
    {
      name: 'Fuba de canjica',
      category: 'INGREDIENTE',
      unit: 'g',
      purchasePackSize: 1000,
      purchasePackCost: 0
    },
    {
      name: 'Acucar',
      category: 'INGREDIENTE',
      unit: 'g',
      purchasePackSize: 1000,
      purchasePackCost: 0
    },
    {
      name: 'Manteiga',
      category: 'INGREDIENTE',
      unit: 'g',
      purchasePackSize: 500,
      purchasePackCost: 0
    },
    {
      name: 'Leite',
      category: 'INGREDIENTE',
      unit: 'ml',
      purchasePackSize: 1000,
      purchasePackCost: 0
    },
    {
      name: 'Ovos',
      category: 'INGREDIENTE',
      unit: 'uni',
      purchasePackSize: 20,
      purchasePackCost: 0
    },
    {
      name: 'Goiabada',
      category: 'INGREDIENTE',
      unit: 'g',
      purchasePackSize: 1000,
      purchasePackCost: 0
    },
    {
      name: 'Doce de leite',
      category: 'INGREDIENTE',
      unit: 'g',
      purchasePackSize: 1000,
      purchasePackCost: 0
    },
    {
      name: 'Queijo do serro',
      category: 'INGREDIENTE',
      unit: 'g',
      purchasePackSize: 1000,
      purchasePackCost: 0
    },
    {
      name: 'Requeijao de corte',
      category: 'INGREDIENTE',
      unit: 'g',
      purchasePackSize: 1000,
      purchasePackCost: 0
    },
    {
      name: 'Sacola',
      category: 'EMBALAGEM_EXTERNA',
      unit: 'uni',
      purchasePackSize: 10,
      purchasePackCost: 0
    },
    {
      name: 'Caixa de plastico',
      category: 'EMBALAGEM_INTERNA',
      unit: 'uni',
      purchasePackSize: 100,
      purchasePackCost: 0
    },
    {
      name: 'Papel manteiga',
      category: 'EMBALAGEM_INTERNA',
      unit: 'cm',
      purchasePackSize: 7000,
      purchasePackCost: 0
    }
  ];

  const inventoryMap = new Map<string, number>();
  for (const item of inventoryItems) {
    const existing = await prisma.inventoryItem.findFirst({ where: { name: item.name } });
    const record =
      existing ??
      (await prisma.inventoryItem.create({
        data: item
      }));
    inventoryMap.set(item.name, record.id);

    const hasMovement = await prisma.inventoryMovement.findFirst({
      where: { itemId: record.id }
    });
    if (!hasMovement) {
      await prisma.inventoryMovement.create({
        data: {
          itemId: record.id,
          type: 'ADJUST',
          quantity: item.purchasePackSize,
          reason: 'Carga inicial'
        }
      });
    }
  }

  return inventoryMap;
}

async function ensureBroaBoms(broaProductId: number | undefined, inventoryMap: Map<string, number>) {
  if (!broaProductId) return;

  const bomDefs = [
    { name: 'Broa Tradicional (T)', filling: null as string | null, qtyPerSaleUnit: null as number | null },
    { name: 'Broa Goiabada (G)', filling: 'Goiabada', qtyPerSaleUnit: 35 },
    { name: 'Broa Queijo do Serro (S)', filling: 'Queijo do serro', qtyPerSaleUnit: 35 },
    { name: 'Broa Requeijao (R)', filling: 'Requeijao de corte', qtyPerSaleUnit: 35 },
    { name: 'Broa Doce de Leite (D)', filling: 'Doce de leite', qtyPerSaleUnit: 35 }
  ];

  for (const bomDef of bomDefs) {
    const existingBom = await prisma.bom.findFirst({
      where: { productId: broaProductId, name: bomDef.name }
    });
    if (existingBom) continue;

    const bom = await prisma.bom.create({
      data: {
        productId: broaProductId,
        name: bomDef.name,
        saleUnitLabel: 'Caixa com 7 broas',
        yieldUnits: MASS_READY_BROAS_PER_RECIPE
      }
    });

    const baseItems = [
      {
        name: 'Farinha de trigo',
        qtyPerRecipe: OFFICIAL_BROA_RECIPE_WHEAT_FLOUR_G,
        qtyPerSaleUnit: (OFFICIAL_BROA_RECIPE_WHEAT_FLOUR_G / MASS_READY_BROAS_PER_RECIPE) * ORDER_BOX_UNITS,
        qtyPerUnit: OFFICIAL_BROA_RECIPE_WHEAT_FLOUR_G / MASS_READY_BROAS_PER_RECIPE
      },
      {
        name: 'Fuba de canjica',
        qtyPerRecipe: OFFICIAL_BROA_RECIPE_CANJICA_FUBA_G,
        qtyPerSaleUnit: (OFFICIAL_BROA_RECIPE_CANJICA_FUBA_G / MASS_READY_BROAS_PER_RECIPE) * ORDER_BOX_UNITS,
        qtyPerUnit: OFFICIAL_BROA_RECIPE_CANJICA_FUBA_G / MASS_READY_BROAS_PER_RECIPE
      },
      {
        name: 'Acucar',
        qtyPerRecipe: OFFICIAL_BROA_RECIPE_SUGAR_G,
        qtyPerSaleUnit: (OFFICIAL_BROA_RECIPE_SUGAR_G / MASS_READY_BROAS_PER_RECIPE) * ORDER_BOX_UNITS,
        qtyPerUnit: OFFICIAL_BROA_RECIPE_SUGAR_G / MASS_READY_BROAS_PER_RECIPE
      },
      {
        name: 'Manteiga',
        qtyPerRecipe: OFFICIAL_BROA_RECIPE_BUTTER_G,
        qtyPerSaleUnit: (OFFICIAL_BROA_RECIPE_BUTTER_G / MASS_READY_BROAS_PER_RECIPE) * ORDER_BOX_UNITS,
        qtyPerUnit: OFFICIAL_BROA_RECIPE_BUTTER_G / MASS_READY_BROAS_PER_RECIPE
      },
      {
        name: 'Leite',
        qtyPerRecipe: OFFICIAL_BROA_RECIPE_MILK_ML,
        qtyPerSaleUnit: (OFFICIAL_BROA_RECIPE_MILK_ML / MASS_READY_BROAS_PER_RECIPE) * ORDER_BOX_UNITS,
        qtyPerUnit: OFFICIAL_BROA_RECIPE_MILK_ML / MASS_READY_BROAS_PER_RECIPE
      },
      {
        name: 'Ovos',
        qtyPerRecipe: OFFICIAL_BROA_RECIPE_EGGS_UNITS,
        qtyPerSaleUnit: (OFFICIAL_BROA_RECIPE_EGGS_UNITS / MASS_READY_BROAS_PER_RECIPE) * ORDER_BOX_UNITS,
        qtyPerUnit: OFFICIAL_BROA_RECIPE_EGGS_UNITS / MASS_READY_BROAS_PER_RECIPE
      },
      {
        name: 'Sacola',
        qtyPerRecipe: OFFICIAL_BROA_PAPER_BAGS_PER_RECIPE,
        qtyPerSaleUnit: 1 / ORDER_PAPER_BAG_BOX_CAPACITY,
        qtyPerUnit: 1 / (ORDER_BOX_UNITS * ORDER_PAPER_BAG_BOX_CAPACITY)
      },
      {
        name: 'Caixa de plastico',
        qtyPerRecipe: OFFICIAL_BROA_BOXES_PER_RECIPE,
        qtyPerSaleUnit: 1,
        qtyPerUnit: 1 / ORDER_BOX_UNITS
      },
      {
        name: 'Papel manteiga',
        qtyPerRecipe: (ORDER_PAPER_MANTEIGA_CM_PER_BOX / ORDER_BOX_UNITS) * MASS_READY_BROAS_PER_RECIPE,
        qtyPerSaleUnit: ORDER_PAPER_MANTEIGA_CM_PER_BOX,
        qtyPerUnit: ORDER_PAPER_MANTEIGA_CM_PER_BOX / ORDER_BOX_UNITS
      }
    ];

    const items = [...baseItems];
    if (bomDef.filling) {
      items.push({
        name: bomDef.filling,
        qtyPerRecipe: OFFICIAL_BROA_FILLING_QTY_PER_UNIT * MASS_READY_BROAS_PER_RECIPE,
        qtyPerSaleUnit: OFFICIAL_BROA_FILLING_QTY_PER_UNIT * ORDER_BOX_UNITS,
        qtyPerUnit: OFFICIAL_BROA_FILLING_QTY_PER_UNIT
      });
    }

    const data = items
      .map((item) => {
        const itemId = inventoryMap.get(item.name);
        if (!itemId) return null;
        return {
          bomId: bom.id,
          itemId,
          qtyPerRecipe: item.qtyPerRecipe,
          qtyPerSaleUnit: item.qtyPerSaleUnit,
          qtyPerUnit: item.qtyPerUnit
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (data.length > 0) {
      await prisma.bomItem.createMany({ data });
    }
  }
}

async function createInventoryConsumptionForOrder(orderId: number, items: Array<{ productId: number; quantity: number }>) {
  const productIds = Array.from(new Set(items.map((item) => item.productId)));
  const boms = await prisma.bom.findMany({
    where: { productId: { in: productIds } },
    include: { items: true },
    orderBy: { id: 'asc' }
  });
  const bomByProduct = new Map<number, (typeof boms)[number]>();
  for (const bom of boms) {
    if (!bomByProduct.has(bom.productId)) {
      bomByProduct.set(bom.productId, bom);
    }
  }

  for (const orderItem of items) {
    const bom = bomByProduct.get(orderItem.productId);
    if (!bom) continue;
    const unitsPerSale = parseSaleUnits(bom.saleUnitLabel);
    for (const bomItem of bom.items) {
      let perUnit = bomItem.qtyPerUnit ?? null;
      if (perUnit == null && bomItem.qtyPerSaleUnit != null) {
        perUnit = unitsPerSale > 0 ? bomItem.qtyPerSaleUnit / unitsPerSale : bomItem.qtyPerSaleUnit;
      }
      if (perUnit == null && bomItem.qtyPerRecipe != null && bom.yieldUnits) {
        perUnit = bomItem.qtyPerRecipe / bom.yieldUnits;
      }
      if (perUnit == null) continue;
      await prisma.inventoryMovement.create({
        data: {
          itemId: bomItem.itemId,
          orderId,
          type: 'OUT',
          quantity: perUnit * orderItem.quantity,
          reason: 'Consumo por pedido (seed)'
        }
      });
    }
  }
}

async function ensureSeedOrders(
  customersByPhone: Map<string, { id: number; name: string }>,
  productsByName: Map<string, { id: number; price: number }>
) {
  const ordersSeed: OrderSeed[] = [
    {
      key: '[seed] PED-001',
      customerPhone: '+55 11 98888-0000',
      status: 'ABERTO',
      discount: 5,
      daysAgo: 1,
      items: [
        { productName: 'Broa (Caixa c/7)', quantity: 3 },
        { productName: 'Refrigerante 350ml', quantity: 2 }
      ],
      payments: [{ amount: 40, method: 'pix', daysAgo: 1 }]
    },
    {
      key: '[seed] PED-002',
      customerPhone: '+55 11 97777-0000',
      status: 'PRONTO',
      daysAgo: 2,
      items: [
        { productName: 'Hamburguer artesanal', quantity: 2 },
        { productName: 'Cerveja IPA 500ml', quantity: 2 }
      ],
      payments: [{ amount: 'TOTAL', method: 'cartao', daysAgo: 2 }]
    },
    {
      key: '[seed] PED-003',
      customerPhone: '+55 11 96666-0000',
      status: 'ABERTO',
      daysAgo: 0,
      items: [{ productName: 'Broa (Caixa c/7)', quantity: 2 }]
    }
  ];

  for (const seedOrder of ordersSeed) {
    const existingOrder = await prisma.order.findFirst({
      where: { notes: seedOrder.key }
    });
    if (existingOrder) continue;

    const customer = customersByPhone.get(seedOrder.customerPhone);
    if (!customer) continue;

    const itemsData = seedOrder.items.map((item) => {
      const product = productsByName.get(item.productName);
      if (!product) {
        throw new Error(`Produto de seed nao encontrado: ${item.productName}`);
      }
      const unitPrice = toMoney(product.price);
      const total = toMoney(unitPrice * item.quantity);
      return {
        productId: product.id,
        quantity: item.quantity,
        unitPrice,
        total
      };
    });

    const subtotal = toMoney(itemsData.reduce((sum, item) => sum + item.total, 0));
    const discount = toMoney(seedOrder.discount ?? 0);
    const total = toMoney(Math.max(subtotal - discount, 0));
    const now = new Date();
    const daysAgo = seedOrder.daysAgo ?? 0;
    const createdAt = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

    const order = await prisma.order.create({
      data: {
        customerId: customer.id,
        status: seedOrder.status,
        subtotal,
        discount,
        total,
        notes: seedOrder.key,
        createdAt,
        items: {
          create: itemsData
        }
      }
    });

    await createInventoryConsumptionForOrder(
      order.id,
      itemsData.map((item) => ({
        productId: item.productId,
        quantity: item.quantity
      }))
    );

    if (!seedOrder.payments?.length) continue;
    let paidSoFar = 0;

    for (const paymentSeed of seedOrder.payments) {
      const amount =
        paymentSeed.amount === 'TOTAL' ? toMoney(Math.max(total - paidSoFar, 0)) : toMoney(paymentSeed.amount);
      if (amount <= 0) continue;
      const paymentDaysAgo = paymentSeed.daysAgo ?? daysAgo;
      const paidAt = new Date(now.getTime() - paymentDaysAgo * 24 * 60 * 60 * 1000);
      await prisma.payment.create({
        data: {
          orderId: order.id,
          amount,
          method: paymentSeed.method,
          status: 'PAGO',
          paidAt
        }
      });
      paidSoFar = toMoney(paidSoFar + amount);
    }
  }
}

async function main() {
  const customersByPhone = await ensureCustomers();
  const productsByName = await ensureProducts();
  const inventoryMap = await ensureInventoryItems();
  await ensureBroaBoms(productsByName.get('Broa (Caixa c/7)')?.id, inventoryMap);
  await ensureSeedOrders(customersByPhone, productsByName);

  console.log('Seed concluido', {
    customers: customersByPhone.size,
    products: productsByName.size,
    inventoryItems: inventoryMap.size,
    sampleOrders: 3
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
