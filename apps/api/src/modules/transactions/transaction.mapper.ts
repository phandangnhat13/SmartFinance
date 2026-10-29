import type { Category, Transaction } from '@prisma/client';
import type { TransactionDto } from '@smart-finance/shared-types';
import { moneyString } from '../../common/utils/money';

type TransactionWithRelations = Transaction & {
  account?: { name: string } | null;
  category?: Category | null;
};

export function toTransactionDto(transaction: TransactionWithRelations): TransactionDto {
  return {
    id: transaction.id,
    accountId: transaction.accountId,
    accountName: transaction.account?.name,
    categoryId: transaction.categoryId,
    categoryName: transaction.category?.name ?? null,
    type: transaction.type,
    amount: moneyString(transaction.amount),
    currency: transaction.currency,
    description: transaction.description,
    note: transaction.note,
    occurredAt: transaction.occurredAt.toISOString(),
    transferGroupId: transaction.transferGroupId,
    transferDirection: transaction.transferDirection,
    createdAt: transaction.createdAt.toISOString(),
  };
}
