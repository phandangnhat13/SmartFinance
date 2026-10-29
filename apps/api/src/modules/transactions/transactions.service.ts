import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Account, CategoryType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isPositiveMoney, toDecimal } from '../../common/utils/money';
import { resolveDateRange } from '../../common/utils/period';
import { CategoriesService } from '../categories/categories.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { ListTransactionsQuery } from './dto/list-transactions.query';
import { UpdateTransactionDto } from './dto/update-transaction.dto';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categoriesService: CategoriesService,
  ) {}

  async list(userId: string, query: ListTransactionsQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sort = query.sort ?? 'desc';

    const where: Prisma.TransactionWhereInput = { userId };

    if (query.from || query.to) {
      if (!query.from || !query.to) {
        throw new BadRequestException('Cần cung cấp cả from và to');
      }
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { timezone: true },
      });
      try {
        const range = resolveDateRange(query.from, query.to, user?.timezone ?? 'Asia/Ho_Chi_Minh');
        where.occurredAt = { gte: range.start, lt: range.endExclusive };
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : 'Khoảng thời gian không hợp lệ',
        );
      }
    }

    if (query.type) where.type = query.type;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.accountId) where.accountId = query.accountId;
    if (query.q?.trim()) {
      where.description = { contains: query.q.trim(), mode: 'insensitive' };
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        include: {
          account: { select: { name: true } },
          category: true,
        },
        orderBy: [{ occurredAt: sort }, { createdAt: sort }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getByIdOrThrow(userId: string, id: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id, userId },
      include: { account: { select: { name: true } }, category: true },
    });
    if (!transaction) throw new NotFoundException('Không tìm thấy giao dịch');
    return transaction;
  }

  async create(userId: string, dto: CreateTransactionDto) {
    if (!isPositiveMoney(dto.amount)) {
      throw new BadRequestException('Số tiền phải lớn hơn 0');
    }
    const account = await this.getOwnedAccount(userId, dto.accountId);
    if (!dto.categoryId) {
      throw new BadRequestException('Giao dịch thu/chi phải có danh mục');
    }
    await this.categoriesService.getAccessibleOrThrow(
      userId,
      dto.categoryId,
      dto.type as CategoryType,
    );
    const occurredAt = this.parseOccurredAt(dto.occurredAt);
    const currency = dto.currency ?? account.currency;
    if (currency !== account.currency) {
      throw new BadRequestException(
        `Tiền tệ giao dịch phải khớp với tiền tệ tài khoản (${account.currency})`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          userId,
          accountId: dto.accountId,
          categoryId: dto.categoryId,
          type: dto.type,
          amount: toDecimal(dto.amount),
          currency,
          description: dto.description.trim(),
          note: dto.note?.trim() || null,
          occurredAt,
        },
        include: { account: { select: { name: true } }, category: true },
      });

      if (dto.aiPredictionId) {
        const prediction = await tx.aiPrediction.findFirst({
          where: { id: dto.aiPredictionId, userId },
        });
        if (!prediction) {
          throw new BadRequestException('Kết quả AI không hợp lệ');
        }
        await tx.aiPrediction.update({
          where: { id: prediction.id },
          data: {
            transactionId: transaction.id,
            status: prediction.predictedCategoryId === dto.categoryId ? 'ACCEPTED' : 'CORRECTED',
            acceptedCategoryId: dto.categoryId,
          },
        });
      }

      return transaction;
    });
  }

  async createTransfer(userId: string, dto: CreateTransferDto) {
    if (!isPositiveMoney(dto.amount)) {
      throw new BadRequestException('Số tiền phải lớn hơn 0');
    }
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException('Tài khoản nguồn và đích phải khác nhau');
    }
    const from = await this.getOwnedAccount(userId, dto.fromAccountId);
    const to = await this.getOwnedAccount(userId, dto.toAccountId);
    if (from.currency !== to.currency) {
      throw new BadRequestException('MVP chỉ hỗ trợ chuyển tiền cùng loại tiền tệ');
    }
    if (from.isArchived || to.isArchived) {
      throw new BadRequestException('Không thể chuyển tiền với tài khoản đã lưu trữ');
    }

    const occurredAt = this.parseOccurredAt(dto.occurredAt);
    const groupId = randomUUID();
    const description = dto.description?.trim() || 'Chuyển tiền nội bộ';
    const amount = toDecimal(dto.amount);
    const note = dto.note?.trim() || null;

    return this.prisma.$transaction(async (tx) => {
      const out = await tx.transaction.create({
        data: {
          userId,
          accountId: from.id,
          type: 'TRANSFER',
          transferDirection: 'OUT',
          transferGroupId: groupId,
          amount,
          currency: from.currency,
          description,
          note,
          occurredAt,
        },
      });
      const incoming = await tx.transaction.create({
        data: {
          userId,
          accountId: to.id,
          type: 'TRANSFER',
          transferDirection: 'IN',
          transferGroupId: groupId,
          amount,
          currency: to.currency,
          description,
          note,
          occurredAt,
        },
      });
      return [out, incoming];
    });
  }

  async update(userId: string, id: string, dto: UpdateTransactionDto) {
    const existing = await this.getByIdOrThrow(userId, id);
    if (existing.type === 'TRANSFER') {
      throw new BadRequestException(
        'Không thể sửa riêng một vế chuyển tiền. Hãy xoá và tạo lại giao dịch chuyển tiền.',
      );
    }
    if (dto.amount !== undefined && !isPositiveMoney(dto.amount)) {
      throw new BadRequestException('Số tiền phải lớn hơn 0');
    }

    let accountId = existing.accountId;
    if (dto.accountId) {
      const account = await this.getOwnedAccount(userId, dto.accountId);
      if (account.currency !== existing.currency) {
        throw new BadRequestException('Tiền tệ tài khoản không khớp với giao dịch');
      }
      accountId = account.id;
    }
    if (dto.categoryId) {
      await this.categoriesService.getAccessibleOrThrow(
        userId,
        dto.categoryId,
        existing.type as CategoryType,
      );
    }

    return this.prisma.transaction.update({
      where: { id },
      data: {
        ...(accountId !== existing.accountId ? { accountId } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.amount !== undefined ? { amount: toDecimal(dto.amount) } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
        ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}),
        ...(dto.occurredAt !== undefined
          ? { occurredAt: this.parseOccurredAt(dto.occurredAt) }
          : {}),
      },
      include: { account: { select: { name: true } }, category: true },
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.getByIdOrThrow(userId, id);
    if (existing.transferGroupId) {
      await this.prisma.$transaction([
        this.prisma.transaction.deleteMany({
          where: { userId, transferGroupId: existing.transferGroupId },
        }),
      ]);
      return;
    }
    await this.prisma.transaction.delete({ where: { id } });
  }

  private async getOwnedAccount(userId: string, accountId: string): Promise<Account> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, userId } });
    if (!account) {
      throw new BadRequestException('Tài khoản không hợp lệ hoặc không thuộc quyền truy cập');
    }
    if (account.isArchived) {
      throw new BadRequestException('Tài khoản đã lưu trữ, không thể thêm giao dịch');
    }
    return account;
  }

  private parseOccurredAt(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Thời điểm giao dịch không hợp lệ');
    }
    const year = date.getUTCFullYear();
    if (year < 1970 || year > 2100) {
      throw new BadRequestException('Thời điểm giao dịch nằm ngoài phạm vi hỗ trợ');
    }
    return date;
  }
}
