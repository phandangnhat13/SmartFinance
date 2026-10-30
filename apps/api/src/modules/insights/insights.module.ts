import { Module } from '@nestjs/common';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';
import { SavingsRecommendationService } from './savings-recommendation.service';

@Module({
  controllers: [InsightsController],
  providers: [InsightsService, SavingsRecommendationService],
  exports: [InsightsService, SavingsRecommendationService],
})
export class InsightsModule {}
