import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const customer = await prisma.customer.create({
    data: {
      name: 'Cliente Exemplo',
      phone: '+55 11 98888-0000',
      address: 'Rua Exemplo, 123 - Sao Paulo/SP'
    }
  });

  const productsSeed = [
    { name: 'Cerveja IPA 500ml', category: 'Bebidas', unit: 'un', price: 12.5, active: true },
    { name: 'Refrigerante 350ml', category: 'Bebidas', unit: 'un', price: 6.0, active: true },
    { name: 'Hamburguer artesanal', category: 'Lanches', unit: 'un', price: 28.0, active: true },
    { name: 'Broa (Caixa c/7)', category: 'Padaria', unit: 'cx', price: 25.0, active: true }
  ];

  for (const product of productsSeed) {
    const exists = await prisma.product.findFirst({ where: { name: product.name } });
    if (!exists) {
      await prisma.product.create({ data: product });
    }
  }

  const broaProduct = await prisma.product.findFirst({ where: { name: 'Broa (Caixa c/7)' } });

  const inventoryItems = [
    { name: 'Farinha de trigo', category: 'INGREDIENTE', unit: 'g', purchasePackSize: 1000, purchasePackCost: 0 },
    { name: 'Fuba de canjica', category: 'INGREDIENTE', unit: 'g', purchasePackSize: 1000, purchasePackCost: 0 },
    { name: 'Acucar', category: 'INGREDIENTE', unit: 'g', purchasePackSize: 1000, purchasePackCost: 0 },
    { name: 'Manteiga', category: 'INGREDIENTE', unit: 'g', purchasePackSize: 200, purchasePackCost: 0 },
    { name: 'Leite', category: 'INGREDIENTE', unit: 'ml', purchasePackSize: 1000, purchasePackCost: 0 },
    { name: 'Ovos', category: 'INGREDIENTE', unit: 'uni', purchasePackSize: 20, purchasePackCost: 0 },
    { name: 'Goiabada', category: 'INGREDIENTE', unit: 'g', purchasePackSize: 300, purchasePackCost: 0 },
    { name: 'Doce de leite', category: 'INGREDIENTE', unit: 'g', purchasePackSize: 200, purchasePackCost: 0 },
    { name: 'Queijo do serro', category: 'INGREDIENTE', unit: 'g', purchasePackSize: 500, purchasePackCost: 0 },
    { name: 'Requeijao de corte', category: 'INGREDIENTE', unit: 'g', purchasePackSize: 240, purchasePackCost: 0 },
    { name: 'Sacola', category: 'EMBALAGEM_EXTERNA', unit: 'uni', purchasePackSize: 10, purchasePackCost: 0 },
    { name: 'Caixa de plastico', category: 'EMBALAGEM_INTERNA', unit: 'uni', purchasePackSize: 100, purchasePackCost: 0 },
    { name: 'Papel manteiga', category: 'EMBALAGEM_INTERNA', unit: 'cm', purchasePackSize: 7000, purchasePackCost: 0 }
  ];

  const inventoryMap = new Map<string, number>();
  for (const item of inventoryItems) {
    const existing = await prisma.inventoryItem.findFirst({ where: { name: item.name } });
    const record =
      existing ??
      (await prisma.inventoryItem.create({
        data: { ...item, createdAt: now }
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

  if (broaProduct) {
    const bomDefs = [
      { name: 'Broa Tradicional', filling: null },
      { name: 'Broa Goiabada', filling: 'Goiabada', qtyPerSaleUnit: 35 },
      { name: 'Broa Queijo', filling: 'Queijo do serro', qtyPerSaleUnit: 35 },
      { name: 'Broa Requeijao', filling: 'Requeijao de corte', qtyPerSaleUnit: 35 },
      { name: 'Broa Doce de leite', filling: 'Doce de leite', qtyPerSaleUnit: 56 }
    ];

    for (const bomDef of bomDefs) {
      const existingBom = await prisma.bom.findFirst({ where: { name: bomDef.name } });
      if (existingBom) continue;

      const bom = await prisma.bom.create({
        data: {
          productId: broaProduct.id,
          name: bomDef.name,
          saleUnitLabel: 'Caixa com 7 broas',
          yieldUnits: 12
        }
      });

      const baseItems = [
        { name: 'Farinha de trigo', qtyPerRecipe: 60, qtyPerSaleUnit: 35, qtyPerUnit: 5 },
        { name: 'Fuba de canjica', qtyPerRecipe: 60, qtyPerSaleUnit: 35, qtyPerUnit: 5 },
        { name: 'Acucar', qtyPerRecipe: 60, qtyPerSaleUnit: 35, qtyPerUnit: 5 },
        { name: 'Manteiga', qtyPerRecipe: 75, qtyPerSaleUnit: 43.75, qtyPerUnit: 6.25 },
        { name: 'Leite', qtyPerRecipe: 60, qtyPerSaleUnit: 35, qtyPerUnit: 5 },
        { name: 'Ovos', qtyPerRecipe: 3, qtyPerSaleUnit: 1.75, qtyPerUnit: 0.25 },
        { name: 'Sacola', qtyPerRecipe: 1.7, qtyPerSaleUnit: 1, qtyPerUnit: 0.14 },
        { name: 'Caixa de plastico', qtyPerRecipe: 1.7, qtyPerSaleUnit: 1, qtyPerUnit: 0.14 },
        { name: 'Papel manteiga', qtyPerRecipe: 27.4, qtyPerSaleUnit: 16, qtyPerUnit: 2.29 }
      ];

      const items = [...baseItems];
      if (bomDef.filling) {
        items.push({
          name: bomDef.filling,
          qtyPerRecipe: bomDef.qtyPerSaleUnit ? (bomDef.qtyPerSaleUnit * 12) / 7 : 60,
          qtyPerSaleUnit: bomDef.qtyPerSaleUnit ?? 35,
          qtyPerUnit: bomDef.qtyPerSaleUnit ? bomDef.qtyPerSaleUnit / 7 : 5
        });
      }

      await prisma.bomItem.createMany({
        data: items.map((item) => ({
          bomId: bom.id,
          itemId: inventoryMap.get(item.name)!,
          qtyPerRecipe: item.qtyPerRecipe,
          qtyPerSaleUnit: item.qtyPerSaleUnit,
          qtyPerUnit: item.qtyPerUnit
        }))
      });
    }
  }

  console.log('Seed concluido', { customerId: customer.id });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
