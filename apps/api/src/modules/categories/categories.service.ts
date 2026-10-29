import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Category, CategoryType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, type?: CategoryType, includeArchived = false): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: {
        OR: [{ isSystem: true }, { userId }],
        ...(type ? { type } : {}),
        ...(includeArchived ? {} : { isArchived: false }),
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
  }

  async create(userId: string, dto: CreateCategoryDto): Promise<Category> {
    return this.prisma.category.create({
      data: {
        userId,
        name: dto.name.trim(),
        type: dto.type,
        isSystem: false,
      },
    });
  }

  /**
   * A category is usable when it is a system category or belongs to the user,
   * has not been archived, and (when given) matches the expected transaction type.
   */
  async getAccessibleOrThrow(
    userId: string,
    categoryId: string,
    expectedType?: CategoryType,
  ): Promise<Category> {
    const category = await this.prisma.category.findFirst({
      where: {
        id: categoryId,
        isArchived: false,
        OR: [{ isSystem: true }, { userId }],
      },
    });
    if (!category) {
      throw new BadRequestException('Danh mục không hợp lệ hoặc không thuộc quyền truy cập');
    }
    if (expectedType && category.type !== expectedType) {
      throw new BadRequestException('Loại danh mục không khớp với loại giao dịch');
    }
    return category;
  }

  async update(userId: string, id: string, dto: UpdateCategoryDto): Promise<Category> {
    const category = await this.prisma.category.findFirst({ where: { id, userId } });
    if (!category) {
      if (await this.prisma.category.findFirst({ where: { id, isSystem: true } })) {
        throw new ForbiddenException('Không thể sửa danh mục hệ thống');
      }
      throw new NotFoundException('Không tìm thấy danh mục');
    }
    return this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.isArchived !== undefined ? { isArchived: dto.isArchived } : {}),
      },
    });
  }

  async archive(userId: string, id: string): Promise<Category> {
    const category = await this.prisma.category.findFirst({ where: { id, userId } });
    if (!category) {
      if (await this.prisma.category.findFirst({ where: { id, isSystem: true } })) {
        throw new ForbiddenException('Không thể lưu trữ danh mục hệ thống');
      }
      throw new NotFoundException('Không tìm thấy danh mục');
    }
    return this.prisma.category.update({ where: { id }, data: { isArchived: true } });
  }
}
