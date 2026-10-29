import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { HealthController } from './health.controller';

@Module({
  imports: [AiModule],
  controllers: [HealthController],
})
export class HealthModule {}
