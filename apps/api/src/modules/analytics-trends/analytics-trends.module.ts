import { Module } from '@nestjs/common';
import { InsightsModule } from '../insights/insights.module';
import { AnalyticsTrendsController } from './analytics-trends.controller';
import { AnalyticsTrendsService } from './analytics-trends.service';

@Module({
  imports: [InsightsModule],
  controllers: [AnalyticsTrendsController],
  providers: [AnalyticsTrendsService],
  // Read-only overview/trends reused by the AI financial analyst (M3e).
  exports: [AnalyticsTrendsService],
})
export class AnalyticsTrendsModule {}
