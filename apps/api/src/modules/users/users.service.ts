import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isValidTimezone } from '../../common/utils/period';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getByIdOrThrow(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    return user;
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<User> {
    if (dto.timezone && !isValidTimezone(dto.timezone)) {
      throw new BadRequestException('Múi giờ không hợp lệ');
    }
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName.trim() } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.defaultCurrency !== undefined ? { defaultCurrency: dto.defaultCurrency } : {}),
      },
    });
  }

  /**
   * Full personal data export (FR-17). The caller must be authenticated as the
   * owner; no other user's data is included.
   */
  async exportData(userId: string) {
    const user = await this.getByIdOrThrow(userId);
    const [accounts, categories, transactions, budgets, goals, imports, predictions] =
      await Promise.all([
        this.prisma.account.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
        this.prisma.category.findMany({
          where: { userId },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.transaction.findMany({
          where: { userId },
          orderBy: { occurredAt: 'asc' },
        }),
        this.prisma.budget.findMany({ where: { userId }, orderBy: { periodStart: 'asc' } }),
        this.prisma.savingsGoal.findMany({
          where: { userId },
          include: { contributions: { orderBy: { contributedAt: 'asc' } } },
        }),
        this.prisma.importBatch.findMany({
          where: { userId },
          include: { rows: { orderBy: { rowNumber: 'asc' } } },
        }),
        this.prisma.aiPrediction.findMany({
          where: { userId },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

    return {
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        defaultCurrency: user.defaultCurrency,
        timezone: user.timezone,
        createdAt: user.createdAt,
      },
      accounts,
      categories,
      transactions,
      budgets,
      goals,
      imports,
      aiPredictions: predictions,
    };
  }

  async deleteAccount(userId: string, password: string): Promise<void> {
    const user = await this.getByIdOrThrow(userId);
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Mật khẩu không đúng');
    }
    // Cascades remove all owned finance data; audit/chat tables are not in MVP.
    await this.prisma.user.delete({ where: { id: userId } });
  }
}
