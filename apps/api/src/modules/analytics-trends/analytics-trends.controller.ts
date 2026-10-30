import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/auth-user.interface';
import { AnalyticsTrendsService } from './analytics-trends.service';
import { AnalyticsPeriodQuery, AnalyticsRangeQuery } from './dto/analytics-trends.query';

/**
 * Historical income/expense analytics (M3a). Read-only, computed from the
 * signed-in user's own transactions; one currency per response.
 *
 * The long-standing `/analytics/summary|by-category|trend|comparison` routes
 * belong to the Dashboard module and are intentionally left untouched. These
 * routes are new names, and the period comparison lives at
 * `/analytics/period-comparison` so it never shadows `/analytics/comparison`.
 */
@ApiTags('analytics')
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsTrendsController {
  constructor(private readonly service: AnalyticsTrendsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Tổng thu, tổng chi, dòng tiền ròng và tỷ lệ tiết kiệm của một kỳ',
  })
  overview(@CurrentUser() current: AuthenticatedUser, @Query() query: AnalyticsPeriodQuery) {
    return this.service.overview(current.id, query);
  }

  @Get('trends')
  @ApiOperation({ summary: 'Chuỗi thu nhập và chi tiêu theo tháng, không nội suy tháng thiếu' })
  trends(@CurrentUser() current: AuthenticatedUser, @Query() query: AnalyticsRangeQuery) {
    return this.service.trends(current.id, query);
  }

  @Get('income')
  @ApiOperation({ summary: 'Phân tích thu nhập theo tháng và theo danh mục nguồn thu' })
  income(@CurrentUser() current: AuthenticatedUser, @Query() query: AnalyticsRangeQuery) {
    return this.service.income(current.id, query);
  }

  @Get('expenses')
  @ApiOperation({ summary: 'Phân tích chi tiêu theo tháng, mức biến động và chuỗi tăng' })
  expenses(@CurrentUser() current: AuthenticatedUser, @Query() query: AnalyticsRangeQuery) {
    return this.service.expenses(current.id, query);
  }

  @Get('period-comparison')
  @ApiOperation({ summary: 'So sánh tháng/quý/năm với kỳ liền trước và thay đổi theo danh mục' })
  comparison(@CurrentUser() current: AuthenticatedUser, @Query() query: AnalyticsPeriodQuery) {
    return this.service.comparison(current.id, query);
  }
}
