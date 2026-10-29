import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CategoryType } from '@prisma/client';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/auth-user.interface';
import { CategoriesService } from './categories.service';
import { toCategoryDto } from './category.mapper';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

class ListCategoriesQuery {
  @IsOptional()
  @IsEnum(CategoryType)
  type?: CategoryType;

  @IsOptional()
  @IsIn(['true', 'false'])
  includeArchived?: string;
}

@ApiTags('categories')
@UseGuards(JwtAuthGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách danh mục hệ thống và danh mục của người dùng' })
  async list(@CurrentUser() current: AuthenticatedUser, @Query() query: ListCategoriesQuery) {
    const categories = await this.categoriesService.list(
      current.id,
      query.type,
      query.includeArchived === 'true',
    );
    return { items: categories.map(toCategoryDto) };
  }

  @Post()
  @ApiOperation({ summary: 'Tạo danh mục riêng' })
  async create(@CurrentUser() current: AuthenticatedUser, @Body() dto: CreateCategoryDto) {
    const category = await this.categoriesService.create(current.id, dto);
    return { category: toCategoryDto(category) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Sửa danh mục riêng' })
  async update(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    const category = await this.categoriesService.update(current.id, id, dto);
    return { category: toCategoryDto(category) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lưu trữ danh mục riêng' })
  async archive(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const category = await this.categoriesService.archive(current.id, id);
    return { category: toCategoryDto(category) };
  }
}
