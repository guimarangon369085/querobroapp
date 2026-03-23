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

  // Avoid relying on a unique-violation catch path here: on PostgreSQL that poisons the
  // surrounding transaction and breaks public-form intake mid-order creation.
  const created = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "PublicSequenceCounter" ("name", "nextValue")
    VALUES (${sequenceName}, ${nextNumber + 1})
    ON CONFLICT ("name") DO NOTHING
  `);

  if (Number(created) > 0) {
    return nextNumber;
  }

  // Optimistic loop to handle stale counters and concurrent allocators without aborting tx.
  // We only commit a number when the compare-and-swap update actually touches the expected row.
  for (;;) {
    const currentSequence = await tx.publicSequenceCounter.findUnique({
      where: { name: sequenceName },
      select: { nextValue: true }
    });

    if (!currentSequence) continue;

    if (currentSequence.nextValue < nextNumber) {
      const synced = await tx.publicSequenceCounter.updateMany({
        where: {
          name: sequenceName,
          nextValue: currentSequence.nextValue
        },
        data: {
          nextValue: nextNumber + 1
        }
      });

      if (synced.count === 1) {
        return Math.max(nextNumber, 1);
      }
      continue;
    }

    const bumped = await tx.publicSequenceCounter.updateMany({
      where: {
        name: sequenceName,
        nextValue: currentSequence.nextValue
      },
      data: {
        nextValue: {
          increment: 1
        }
      }
    });

    if (bumped.count === 1) {
      return Math.max(currentSequence.nextValue, 1);
    }
  }
}
