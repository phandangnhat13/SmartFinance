import { Module } from '@nestjs/common';
import { AnalyticsCategoryBudgetModule } from '../analytics-category-budget/analytics-category-budget.module';
import { AnalyticsForecastModule } from '../analytics-forecast/analytics-forecast.module';
import { InsightsModule } from '../insights/insights.module';
import { SavingsModule } from '../savings/savings.module';
import { FinancialHealthController } from './financial-health.controller';
import { FinancialHealthService } from './financial-health.service';

@Module({
  imports: [InsightsModule, AnalyticsCategoryBudgetModule, AnalyticsForecastModule, SavingsModule],
  controllers: [FinancialHealthController],
  providers: [FinancialHealthService],
  exports: [FinancialHealthService],
})
export class AnalyticsFinancialHealthModule {}
