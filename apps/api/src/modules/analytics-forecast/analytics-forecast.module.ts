import { Module } from '@nestjs/common';
import { AnalyticsForecastController } from './analytics-forecast.controller';
import { AnalyticsForecastService } from './analytics-forecast.service';

@Module({
  controllers: [AnalyticsForecastController],
  providers: [AnalyticsForecastService],
  // Read-only service reused by the financial health score (M3d).
  exports: [AnalyticsForecastService],
})
export class AnalyticsForecastModule {}
