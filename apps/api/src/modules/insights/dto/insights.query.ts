import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { MONTH_REGEX } from '../../../common/utils/period';

export const MAX_INSIGHT_MONTHS = 24;

export class InsightsQuery {
  @ApiPropertyOptional({ example: '2026-10', description: 'Tháng cần phân tích (YYYY-MM)' })
  @IsOptional()
  @Matches(MONTH_REGEX, { message: 'month phải có định dạng YYYY-MM' })
  month?: string;

  @ApiPropertyOptional({ example: 'VND', description: 'Mã tiền tệ 3 ký tự' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, { message: 'currency phải là mã 3 ký tự, ví dụ VND' })
  currency?: string;
}

export class MonthlyInsightsQuery extends InsightsQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_INSIGHT_MONTHS, default: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'months phải là số nguyên' })
  @Min(1)
  @Max(MAX_INSIGHT_MONTHS)
  months?: number;
}
