import { Prisma } from '@prisma/client';

type TransactionClient = Prisma.TransactionClient;

export const CUSTOMER_PUBLIC_SEQUENCE = 'customerPublicNumber';
export const ORDER_PUBLIC_SEQUENCE = 'orderPublicNumber';

export async function allocateNextPublicNumber(
  tx: TransactionClient,
  target: 'CUSTOMER' | 'ORDER'
) {
  const sequenceName = target === 'CUSTOMER' ? CUSTOMER_PUBLIC_SEQUENCE : ORDER_PUBLIC_SEQUENCE;
  const currentMax =
    target === 'CUSTOMER'
      ? (await tx.customer.aggregate({ _max: { publicNumber: true } }))._max.publicNumber ?? 0
      : (await tx.order.aggregate({ _max: { publicNumber: true } }))._max.publicNumber ?? 0;
  const nextNumber = currentMax + 1;

  try {
    await tx.publicSequenceCounter.create({
      data: {
        name: sequenceName,
        nextValue: nextNumber + 1
      }
    });
    return nextNumber;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
  }

  const currentSequence = await tx.publicSequenceCounter.findUnique({
    where: { name: sequenceName }
  });
  if (currentSequence && currentSequence.nextValue < nextNumber) {
    await tx.publicSequenceCounter.update({
      where: { name: sequenceName },
      data: {
        nextValue: nextNumber
      }
    });
  }

  const updated = await tx.publicSequenceCounter.update({
    where: { name: sequenceName },
    data: {
      nextValue: {
        increment: 1
      }
    }
  });

  return Math.max(updated.nextValue - 1, 1);
}
