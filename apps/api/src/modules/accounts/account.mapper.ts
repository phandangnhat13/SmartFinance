import type { Account, Prisma } from '@prisma/client';
import type { AccountDto } from '@smart-finance/shared-types';
import { moneyString } from '../../common/utils/money';

export function toAccountDto(account: Account, balance: Prisma.Decimal): AccountDto {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    initialBalance: moneyString(account.initialBalance),
    balance: moneyString(balance),
    currency: account.currency,
    isArchived: account.isArchived,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}
