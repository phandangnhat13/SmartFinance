import { Module } from '@nestjs/common';
import { GoalsModule } from '../goals/goals.module';
import { InsightsModule } from '../insights/insights.module';
import { SavingsController } from './savings.controller';
import { SavingsPlanService } from './savings-plan.service';
import { SavingsProgressService } from './savings-progress.service';

@Module({
  imports: [GoalsModule, InsightsModule],
  controllers: [SavingsController],
  providers: [SavingsProgressService, SavingsPlanService],
  // Read-only services, reused by the AI savings assistant (M2e) so the
  // assistant's scenario questions run the same M2d arithmetic.
  exports: [SavingsProgressService, SavingsPlanService],
})
export class SavingsModule {}
