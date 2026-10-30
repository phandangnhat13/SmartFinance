import { ApiPropertyOptional } from '@nestjs/swagger';
import type { ForecastHorizon } from '@smart-finance/shared-types';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, Matches } from 'class-validator';

export const FORECAST_HORIZONS: ForecastHorizon[] = ['current_month', '1m', '3m', '6m'];

export class ForecastQuery {
  @ApiPropertyOptional({
    enum: FORECAST_HORIZONS,
    default: 'current_month',
    description: 'current_month = phần còn lại của tháng này; 1m/3m/6m = các tháng tiếp theo',
  })
  @IsOptional()
  @IsIn(FORECAST_HORIZONS, {
    message: 'horizon phải là current_month, 1m, 3m hoặc 6m',
  })
  horizon?: ForecastHorizon;

  @ApiPropertyOptional({ example: 'VND', description: 'Mã tiền tệ 3 ký tự' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, { message: 'currency phải là mã 3 ký tự, ví dụ VND' })
  currency?: string;
}
