import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Matches } from 'class-validator';
import { MONTH_REGEX } from '../../../common/utils/period';
import {
  ANALYTICS_MONTH_OPTIONS,
  AnalyticsPeriodQuery,
} from '../../analytics-trends/dto/analytics-trends.query';

export class CategoryAnalyticsQuery extends AnalyticsPeriodQuery {
  @ApiPropertyOptional({ enum: ['INCOME', 'EXPENSE'], default: 'EXPENSE' })
  @IsOptional()
  @IsIn(['INCOME', 'EXPENSE'], { message: 'type phải là INCOME hoặc EXPENSE' })
  type?: 'INCOME' | 'EXPENSE';

  @ApiPropertyOptional({
    description: 'Danh mục cần xem xu hướng theo tháng (UUID)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'categoryId phải là UUID' })
  categoryId?: string;

  @ApiPropertyOptional({
    enum: ANALYTICS_MONTH_OPTIONS,
    default: 6,
    description: 'Số tháng của chuỗi xu hướng danh mục',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'months phải là số nguyên' })
  @IsIn(ANALYTICS_MONTH_OPTIONS, { message: 'months phải là 3, 6, 12 hoặc 24' })
  months?: number;
}

export class BudgetAnalyticsQuery {
  @ApiPropertyOptional({
    example: '2026-10',
    description: 'Tháng của ngân sách (YYYY-MM), mặc định là tháng hiện tại',
  })
  @IsOptional()
  @Matches(MONTH_REGEX, { message: 'month phải có định dạng YYYY-MM' })
  month?: string;

  @ApiPropertyOptional({ example: 'VND', description: 'Mã tiền tệ 3 ký tự' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, { message: 'currency phải là mã 3 ký tự, ví dụ VND' })
  currency?: string;
}
