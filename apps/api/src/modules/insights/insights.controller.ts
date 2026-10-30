import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/auth-user.interface';
import { InsightsQuery, MonthlyInsightsQuery } from './dto/insights.query';
import { InsightsService } from './insights.service';

/**
 * Read-only financial insights computed from the signed-in user's own
 * transactions. One currency per response; transfer rows never count.
 */
@ApiTags('insights')
@UseGuards(JwtAuthGuard)
@Controller('insights')
export class InsightsController {
  constructor(private readonly insightsService: InsightsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Tổng thu, tổng chi, dòng tiền ròng và tỷ lệ tiết kiệm của một tháng' })
  overview(@CurrentUser() current: AuthenticatedUser, @Query() query: InsightsQuery) {
    return this.insightsService.overview(current.id, query);
  }

  @Get('monthly')
  @ApiOperation({ summary: 'Chuỗi thu nhập và chi tiêu theo các tháng liên tiếp' })
  monthly(@CurrentUser() current: AuthenticatedUser, @Query() query: MonthlyInsightsQuery) {
    return this.insightsService.monthly(current.id, query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Chi tiêu theo danh mục và so sánh với tháng trước' })
  categories(@CurrentUser() current: AuthenticatedUser, @Query() query: InsightsQuery) {
    return this.insightsService.categories(current.id, query);
  }
}
