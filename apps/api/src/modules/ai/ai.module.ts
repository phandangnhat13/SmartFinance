import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { AiController } from './ai.controller';
import { AI_PROVIDER, HttpAiProvider } from './ai.provider';
import { AiService } from './ai.service';

@Module({
  imports: [CategoriesModule],
  controllers: [AiController],
  providers: [AiService, HttpAiProvider, { provide: AI_PROVIDER, useExisting: HttpAiProvider }],
  exports: [AiService, HttpAiProvider],
})
export class AiModule {}
