import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const customer = await prisma.customer.create({
    data: {
      name: 'Cliente Exemplo',
      phone: '+55 11 98888-0000',
      address: 'Rua Exemplo, 123 - Sao Paulo/SP'
    }
  });

  await prisma.product.createMany({
    data: [
      {
        name: 'Cerveja IPA 500ml',
        category: 'Bebidas',
        unit: 'un',
        price: 12.5,
        active: true
      },
      {
        name: 'Refrigerante 350ml',
        category: 'Bebidas',
        unit: 'un',
        price: 6.0,
        active: true
      },
      {
        name: 'Hamburguer artesanal',
        category: 'Lanches',
        unit: 'un',
        price: 28.0,
        active: true
      }
    ]
  });

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
