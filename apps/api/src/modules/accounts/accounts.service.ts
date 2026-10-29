import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Account, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isNonNegativeMoney, toDecimal } from '../../common/utils/money';
import { CreateAccountDto, UpdateAccountDto } from './dto/create-account.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, includeArchived = false): Promise<Account[]> {
    return this.prisma.account.findMany({
      where: { userId, ...(includeArchived ? {} : { isArchived: false }) },
      orderBy: [{ isArchived: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async getByIdOrThrow(userId: string, id: string): Promise<Account> {
    const account = await this.prisma.account.findFirst({ where: { id, userId } });
    if (!account) throw new NotFoundException('Không tìm thấy tài khoản');
    return account;
  }

  async create(userId: string, dto: CreateAccountDto): Promise<Account> {
    const initialBalance = dto.initialBalance ?? '0';
    if (!isNonNegativeMoney(initialBalance)) {
      throw new BadRequestException('Số dư ban đầu phải là số không âm');
    }
    return this.prisma.account.create({
      data: {
        userId,
        name: dto.name.trim(),
        type: dto.type,
        initialBalance: toDecimal(initialBalance),
        currency: dto.currency ?? 'VND',
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateAccountDto): Promise<Account> {
    await this.getByIdOrThrow(userId, id);
    if (dto.initialBalance !== undefined && !isNonNegativeMoney(dto.initialBalance)) {
      throw new BadRequestException('Số dư ban đầu phải là số không âm');
    }
    return this.prisma.account.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.initialBalance !== undefined
          ? { initialBalance: toDecimal(dto.initialBalance) }
          : {}),
        ...(dto.isArchived !== undefined ? { isArchived: dto.isArchived } : {}),
      },
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.getByIdOrThrow(userId, id);
    const transactionCount = await this.prisma.transaction.count({
      where: { userId, accountId: id },
    });
    if (transactionCount > 0) {
      throw new ConflictException(
        'Tài khoản đã có giao dịch và không thể xoá. Hãy lưu trữ tài khoản thay vì xoá.',
      );
    }
    await this.prisma.account.delete({ where: { id } });
  }

  /**
   * Balances follow one rule everywhere:
   * initialBalance + INCOME - EXPENSE - TRANSFER_OUT + TRANSFER_IN.
   */
  async computeBalances(
    userId: string,
    accountIds: string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    const result = new Map<string, Prisma.Decimal>();
    if (accountIds.length === 0) return result;

    const accounts = await this.prisma.account.findMany({
      where: { userId, id: { in: accountIds } },
      select: { id: true, initialBalance: true },
    });
    for (const account of accounts) {
      result.set(account.id, account.initialBalance);
    }

    const grouped = await this.prisma.transaction.groupBy({
      by: ['accountId', 'type', 'transferDirection'],
      where: { userId, accountId: { in: accountIds } },
      _sum: { amount: true },
    });

    for (const row of grouped) {
      const current = result.get(row.accountId) ?? new Prisma.Decimal(0);
      const amount = row._sum.amount ?? new Prisma.Decimal(0);
      let next = current;
      if (row.type === 'INCOME') next = current.plus(amount);
      else if (row.type === 'EXPENSE') next = current.minus(amount);
      else if (row.type === 'TRANSFER') {
        next = row.transferDirection === 'IN' ? current.plus(amount) : current.minus(amount);
      }
      result.set(row.accountId, next);
    }

    return result;
  }
}
