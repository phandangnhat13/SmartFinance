import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches } from 'class-validator';
import { DATE_ONLY_REGEX, MONTH_REGEX } from '../../../common/utils/period';
import { QUARTER_REGEX, YEAR_REGEX } from '../analytics-period';

export const ANALYTICS_MONTH_OPTIONS = [3, 6, 12, 24] as const;

class AnalyticsCurrencyQuery {
  @ApiPropertyOptional({ example: 'VND', description: 'Mã tiền tệ 3 ký tự' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, { message: 'currency phải là mã 3 ký tự, ví dụ VND' })
  currency?: string;
}

/**
 * A calendar period selected by the user. Exactly one anchor is used for a
 * built-in period; a custom period requires `from` and `to`.
 */
export class AnalyticsPeriodQuery extends AnalyticsCurrencyQuery {
  @ApiPropertyOptional({ enum: ['month', 'quarter', 'year', 'custom'], default: 'month' })
  @IsOptional()
  @IsIn(['month', 'quarter', 'year', 'custom'], {
    message: 'period phải là month, quarter, year hoặc custom',
  })
  period?: 'month' | 'quarter' | 'year' | 'custom';

  @ApiPropertyOptional({ example: '2026-10', description: 'Tháng (YYYY-MM)' })
  @IsOptional()
  @Matches(MONTH_REGEX, { message: 'month phải có định dạng YYYY-MM' })
  month?: string;

  @ApiPropertyOptional({ example: '2026-Q4', description: 'Quý (YYYY-Q1..Q4)' })
  @IsOptional()
  @Matches(QUARTER_REGEX, { message: 'quarter phải có định dạng YYYY-Q1..Q4' })
  quarter?: string;

  @ApiPropertyOptional({ example: '2026', description: 'Năm (YYYY)' })
  @IsOptional()
  @Matches(YEAR_REGEX, { message: 'year phải có định dạng YYYY' })
  year?: string;

  @ApiPropertyOptional({ example: '2026-01-01', description: 'Từ ngày (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(DATE_ONLY_REGEX, { message: 'from phải có định dạng YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Đến ngày (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(DATE_ONLY_REGEX, { message: 'to phải có định dạng YYYY-MM-DD' })
  to?: string;
}

/** A rolling monthly window ending at `month` (defaults to the current month). */
export class AnalyticsRangeQuery extends AnalyticsCurrencyQuery {
  @ApiPropertyOptional({
    enum: ANALYTICS_MONTH_OPTIONS,
    default: 6,
    description: 'Số tháng liên tiếp cần phân tích',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'months phải là số nguyên' })
  @IsIn(ANALYTICS_MONTH_OPTIONS, { message: 'months phải là 3, 6, 12 hoặc 24' })
  months?: number;

  @ApiPropertyOptional({
    example: '2026-10',
    description: 'Tháng cuối của khoảng (YYYY-MM), mặc định là tháng hiện tại',
  })
  @IsOptional()
  @Matches(MONTH_REGEX, { message: 'month phải có định dạng YYYY-MM' })
  month?: string;
}
