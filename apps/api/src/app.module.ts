import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './common/prisma/prisma.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AiModule } from './modules/ai/ai.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AnalyticsCategoryBudgetModule } from './modules/analytics-category-budget/analytics-category-budget.module';
import { AnalyticsFinancialHealthModule } from './modules/analytics-financial-health/financial-health.module';
import { AnalyticsForecastModule } from './modules/analytics-forecast/analytics-forecast.module';
import { AnalyticsTrendsModule } from './modules/analytics-trends/analytics-trends.module';
import { AuthModule } from './modules/auth/auth.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { GoalsModule } from './modules/goals/goals.module';
import { HealthModule } from './modules/health/health.module';
import { ImportsModule } from './modules/imports/imports.module';
import { InsightsModule } from './modules/insights/insights.module';
import { SavingsModule } from './modules/savings/savings.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 120,
      },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    AccountsModule,
    CategoriesModule,
    TransactionsModule,
    BudgetsModule,
    GoalsModule,
    AlertsModule,
    AnalyticsModule,
    AnalyticsTrendsModule,
    AnalyticsCategoryBudgetModule,
    AnalyticsForecastModule,
    AnalyticsFinancialHealthModule,
    InsightsModule,
    SavingsModule,
    ImportsModule,
    AiModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
