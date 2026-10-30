import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyticsCategoryBudgetModule } from '../analytics-category-budget/analytics-category-budget.module';
import { AnalyticsFinancialHealthModule } from '../analytics-financial-health/financial-health.module';
import { AnalyticsForecastModule } from '../analytics-forecast/analytics-forecast.module';
import { AnalyticsTrendsModule } from '../analytics-trends/analytics-trends.module';
import { CategoriesModule } from '../categories/categories.module';
import { InsightsModule } from '../insights/insights.module';
import { SavingsModule } from '../savings/savings.module';
import { AiController } from './ai.controller';
import { AI_PROVIDER, HttpAiProvider } from './ai.provider';
import { AiService } from './ai.service';
import { AnalyticsAnalystController } from './analytics-analyst/analytics-analyst.controller';
import { AnalyticsAnalystService } from './analytics-analyst/analytics-analyst.service';
import { AiConversationsController } from './conversations/ai-conversations.controller';
import { AiConversationsService } from './conversations/ai-conversations.service';
import { createLlmProvider } from './llm/llm.factory';
import { LLM_PROVIDER } from './llm/llm.types';
import { SavingsAssistantController } from './savings-assistant/savings-assistant.controller';
import { SavingsAssistantService } from './savings-assistant/savings-assistant.service';

@Module({
  imports: [
    CategoriesModule,
    SavingsModule,
    InsightsModule,
    AnalyticsTrendsModule,
    AnalyticsCategoryBudgetModule,
    AnalyticsForecastModule,
    AnalyticsFinancialHealthModule,
  ],
  controllers: [
    AiController,
    SavingsAssistantController,
    AnalyticsAnalystController,
    AiConversationsController,
  ],
  providers: [
    AiService,
    HttpAiProvider,
    { provide: AI_PROVIDER, useExisting: HttpAiProvider },
    SavingsAssistantService,
    AnalyticsAnalystService,
    AiConversationsService,
    {
      // Disabled unless explicitly configured; never enabled by a typo.
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createLlmProvider({
          provider: config.get<string>('LLM_PROVIDER'),
          apiKey: config.get<string>('LLM_API_KEY'),
          model: config.get<string>('LLM_MODEL'),
          baseUrl: config.get<string>('LLM_BASE_URL'),
          timeoutMs: config.get<string>('LLM_TIMEOUT_MS'),
          maxRetries: config.get<string>('LLM_MAX_RETRIES'),
          maxTokens: config.get<string>('LLM_MAX_TOKENS'),
        }),
    },
  ],
  exports: [AiService, HttpAiProvider],
})
export class AiModule {}
