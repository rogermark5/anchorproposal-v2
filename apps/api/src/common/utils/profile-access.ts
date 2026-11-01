import { Prisma } from '@prisma/client';

/** Admin access comes from ownership or an explicit Master grant. */
export function profileAccessWhere(user: { id: string; role: string }): Prisma.ProfileWhereInput {
  if (user.role === 'MASTER') return {};
  if (user.role === 'ADMIN') return {
    OR: [
      { ownerId: user.id },
      { assignments: { some: { userId: user.id, activeTo: null, grantedByMaster: true } } },
    ],
  };
  return { assignments: { some: { userId: user.id, activeTo: null } } };
}
