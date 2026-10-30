import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SpendingAlertStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isAlertStatusTransitionAllowed, nextResolvedAt } from './alert-status';
import type { ListAlertsQuery } from './dto/list-alerts.query';

/** Everything the API needs; nothing else is read from the table. */
export const ALERT_SELECT = {
  id: true,
  type: true,
  severity: true,
  status: true,
  dedupeKey: true,
  transactionId: true,
  relatedTransactionId: true,
  categoryId: true,
  periodStart: true,
  periodEnd: true,
  score: true,
  facts: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  category: { select: { name: true } },
} satisfies Prisma.SpendingAlertSelect;

export type AlertRecord = Prisma.SpendingAlertGetPayload<{ select: typeof ALERT_SELECT }>;

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: ListAlertsQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.SpendingAlertWhereInput = { userId };
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;

    // `id` is the tie-breaker: createdAt can collide when many alerts are
    // inserted by one scan, and pagination must not repeat or skip rows.
    const [total, items] = await this.prisma.$transaction([
      this.prisma.spendingAlert.count({ where }),
      this.prisma.spendingAlert.findMany({
        where,
        select: ALERT_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

  async getOwnedOrThrow(userId: string, id: string): Promise<AlertRecord> {
    const alert = await this.prisma.spendingAlert.findFirst({
      where: { id, userId },
      select: ALERT_SELECT,
    });
    if (!alert) throw new NotFoundException('Không tìm thấy cảnh báo');
    return alert;
  }

  /**
   * Only the status may change. Ownership is part of the UPDATE predicate, so a
   * concurrent delete or a foreign id can never be written.
   */
  async updateStatus(
    userId: string,
    id: string,
    status: SpendingAlertStatus,
  ): Promise<AlertRecord> {
    const existing = await this.prisma.spendingAlert.findFirst({
      where: { id, userId },
      select: { id: true, status: true, resolvedAt: true },
    });
    if (!existing) throw new NotFoundException('Không tìm thấy cảnh báo');

    if (!isAlertStatusTransitionAllowed(existing.status, status)) {
      throw new BadRequestException(
        `Không thể chuyển cảnh báo từ ${existing.status} sang ${status}`,
      );
    }
    if (existing.status === status) return this.getOwnedOrThrow(userId, id);

    await this.prisma.spendingAlert.updateMany({
      where: { id, userId },
      data: { status, resolvedAt: nextResolvedAt(status, existing.resolvedAt) },
    });
    return this.getOwnedOrThrow(userId, id);
  }
}
