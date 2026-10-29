import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GoalContribution, SavingsGoal } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isPositiveMoney, toDecimal } from '../../common/utils/money';
import { CreateContributionDto, CreateGoalDto, UpdateGoalDto } from './dto/goal.dto';

type GoalWithContributions = SavingsGoal & { contributions: GoalContribution[] };

@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, includeArchived = false): Promise<GoalWithContributions[]> {
    return this.prisma.savingsGoal.findMany({
      where: { userId, ...(includeArchived ? {} : { status: { not: 'ARCHIVED' } }) },
      include: { contributions: { orderBy: { contributedAt: 'desc' } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async getOwnedOrThrow(userId: string, id: string): Promise<GoalWithContributions> {
    const goal = await this.prisma.savingsGoal.findFirst({
      where: { id, userId },
      include: { contributions: { orderBy: { contributedAt: 'desc' } } },
    });
    if (!goal) throw new NotFoundException('Không tìm thấy mục tiêu tiết kiệm');
    return goal;
  }

  async create(userId: string, dto: CreateGoalDto) {
    if (!isPositiveMoney(dto.targetAmount)) {
      throw new BadRequestException('Số tiền mục tiêu phải lớn hơn 0');
    }
    return this.prisma.savingsGoal.create({
      data: {
        userId,
        name: dto.name.trim(),
        targetAmount: toDecimal(dto.targetAmount),
        targetDate: dto.targetDate ? new Date(`${dto.targetDate}T00:00:00.000Z`) : null,
      },
      include: { contributions: true },
    });
  }

  async update(userId: string, id: string, dto: UpdateGoalDto) {
    await this.getOwnedOrThrow(userId, id);
    if (dto.targetAmount !== undefined && !isPositiveMoney(dto.targetAmount)) {
      throw new BadRequestException('Số tiền mục tiêu phải lớn hơn 0');
    }
    return this.prisma.savingsGoal.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.targetAmount !== undefined ? { targetAmount: toDecimal(dto.targetAmount) } : {}),
        ...(dto.targetDate !== undefined
          ? { targetDate: new Date(`${dto.targetDate}T00:00:00.000Z`) }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      include: { contributions: { orderBy: { contributedAt: 'desc' } } },
    });
  }

  async archive(userId: string, id: string) {
    await this.getOwnedOrThrow(userId, id);
    return this.prisma.savingsGoal.update({
      where: { id },
      data: { status: 'ARCHIVED' },
      include: { contributions: { orderBy: { contributedAt: 'desc' } } },
    });
  }

  async addContribution(userId: string, goalId: string, dto: CreateContributionDto) {
    const goal = await this.getOwnedOrThrow(userId, goalId);
    if (goal.status === 'ARCHIVED') {
      throw new BadRequestException('Mục tiêu đã lưu trữ, không thể ghi nhận đóng góp');
    }
    if (!isPositiveMoney(dto.amount)) {
      throw new BadRequestException('Số tiền đóng góp phải lớn hơn 0');
    }
    const contributedAt = new Date(dto.contributedAt);
    if (Number.isNaN(contributedAt.getTime())) {
      throw new BadRequestException('Thời điểm đóng góp không hợp lệ');
    }
    await this.prisma.goalContribution.create({
      data: {
        goalId,
        userId,
        amount: toDecimal(dto.amount),
        contributedAt,
        note: dto.note?.trim() || null,
      },
    });
    return this.getOwnedOrThrow(userId, goalId);
  }
}
