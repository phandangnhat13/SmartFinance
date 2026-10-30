import { Module } from '@nestjs/common';
import { CategoryBudgetAnalyticsController } from './category-budget-analytics.controller';
import { CategoryBudgetAnalyticsService } from './category-budget-analytics.service';

@Module({
  controllers: [CategoryBudgetAnalyticsController],
  providers: [CategoryBudgetAnalyticsService],
  exports: [CategoryBudgetAnalyticsService],
})
export class AnalyticsCategoryBudgetModule {}
