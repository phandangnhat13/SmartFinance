import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { DATE_ONLY_REGEX } from '../../../common/utils/period';

export class AnalyticsQuery {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DATE_ONLY_REGEX, { message: 'from phải có định dạng YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(DATE_ONLY_REGEX, { message: 'to phải có định dạng YYYY-MM-DD' })
  to?: string;
}

export class TrendQuery extends AnalyticsQuery {
  @ApiPropertyOptional({ enum: ['day', 'month'], default: 'day' })
  @IsOptional()
  @IsIn(['day', 'month'])
  interval?: 'day' | 'month';
}
