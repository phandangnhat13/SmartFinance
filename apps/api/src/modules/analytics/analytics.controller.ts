import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/auth-user.interface';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQuery, TrendQuery } from './dto/analytics.query';

@ApiTags('analytics')
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Tổng thu, tổng chi và dòng tiền ròng' })
  summary(@CurrentUser() current: AuthenticatedUser, @Query() query: AnalyticsQuery) {
    return this.analyticsService.summary(current.id, query.from, query.to);
  }

  @Get('by-category')
  @ApiOperation({ summary: 'Chi tiêu theo danh mục' })
  byCategory(@CurrentUser() current: AuthenticatedUser, @Query() query: AnalyticsQuery) {
    return this.analyticsService.byCategory(current.id, query.from, query.to);
  }

  @Get('trend')
  @ApiOperation({ summary: 'Xu hướng thu chi theo ngày hoặc tháng' })
  trend(@CurrentUser() current: AuthenticatedUser, @Query() query: TrendQuery) {
    return this.analyticsService.trend(current.id, query.from, query.to, query.interval ?? 'day');
  }

  @Get('comparison')
  @ApiOperation({ summary: 'So sánh kỳ hiện tại với kỳ trước có cùng độ dài' })
  comparison(@CurrentUser() current: AuthenticatedUser, @Query() query: AnalyticsQuery) {
    return this.analyticsService.comparison(current.id, query.from, query.to);
  }
}
