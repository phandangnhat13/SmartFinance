import { ApiPropertyOptional } from '@nestjs/swagger';
import { SpendingAlertStatus, SpendingAlertType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Upper bound for `page`. It is not enough to rely on JavaScript's safe-integer
 * range: `skip = (page - 1) * limit` is sent to PostgreSQL as OFFSET, which
 * must fit a 64-bit signed integer, and Prisma rejects anything larger with a
 * validation error (HTTP 500). At 100 000 pages × the maximum 100 rows this
 * still covers 10 million alerts for one user, while `skip` stays around 10^7.
 */
export const MAX_ALERTS_PAGE = 100_000;

export class ListAlertsQuery {
  @ApiPropertyOptional({ enum: SpendingAlertStatus })
  @IsOptional()
  @IsEnum(SpendingAlertStatus)
  status?: SpendingAlertStatus;

  @ApiPropertyOptional({ enum: SpendingAlertType })
  @IsOptional()
  @IsEnum(SpendingAlertType)
  type?: SpendingAlertType;

  @ApiPropertyOptional({ default: 1, maximum: MAX_ALERTS_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ALERTS_PAGE)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
