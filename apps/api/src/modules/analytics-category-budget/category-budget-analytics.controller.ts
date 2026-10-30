import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/auth-user.interface';
import { CategoryBudgetAnalyticsService } from './category-budget-analytics.service';
import { BudgetAnalyticsQuery, CategoryAnalyticsQuery } from './dto/category-budget.query';

/**
 * Category & budget analytics (M3b). Read-only and computed from the signed-in
 * user's own transactions. Route names are checked against M3a
 * (`overview|trends|income|expenses|period-comparison`) and the legacy
 * dashboard analytics (`summary|by-category|trend|comparison`); none collide.
 */
@ApiTags('analytics')
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class CategoryBudgetAnalyticsController {
  constructor(private readonly service: CategoryBudgetAnalyticsService) {}

  @Get('categories')
  @ApiOperation({
    summary: 'Phân tích theo danh mục: tỷ trọng, so sánh kỳ trước, danh mục mới/không còn',
  })
  categories(@CurrentUser() current: AuthenticatedUser, @Query() query: CategoryAnalyticsQuery) {
    return this.service.categories(current.id, query);
  }

  @Get('budgets')
  @ApiOperation({
    summary: 'Tiến độ ngân sách trong tháng: hạn mức, đã chi, trạng thái, số ngày',
  })
  budgets(@CurrentUser() current: AuthenticatedUser, @Query() query: BudgetAnalyticsQuery) {
    return this.service.budgets(current.id, query);
  }

  @Get('budget-pace')
  @ApiOperation({
    summary: 'Tốc độ chi tiêu so với hạn mức tuyến tính và ngày cạn ngân sách dự kiến',
  })
  budgetPace(@CurrentUser() current: AuthenticatedUser, @Query() query: BudgetAnalyticsQuery) {
    return this.service.budgetPace(current.id, query);
  }
}
