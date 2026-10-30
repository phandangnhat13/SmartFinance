import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type {
  SavingsChatReplyDto,
  SavingsExplanationDto,
  SavingsScenarioExplanationDto,
  SavingsSuggestionsDto,
} from '@smart-finance/shared-types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/auth-user.interface';
import {
  SavingsChatRequestDto,
  SavingsExplainRequestDto,
  SavingsScenarioRequestDto,
  SavingsSuggestionsRequestDto,
} from './dto/savings-assistant.dto';
import { SavingsAssistantService } from './savings-assistant.service';

/**
 * AI savings assistant endpoints (M2e §11).
 *
 * Every handler is authenticated, scopes all data to `current.id`, and is
 * read-only: there is no route here that can create, update or delete a goal,
 * contribution, transaction or balance.
 */
@ApiTags('ai')
@UseGuards(JwtAuthGuard)
@Controller('ai/savings')
export class SavingsAssistantController {
  constructor(private readonly assistant: SavingsAssistantService) {}

  @Post('explain')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Giải thích kế hoạch tiết kiệm từ số liệu đã tính' })
  explain(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: SavingsExplainRequestDto,
  ): Promise<SavingsExplanationDto> {
    return this.assistant.explain(current.id, dto);
  }

  @Post('suggestions')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Gợi ý tiết kiệm kèm bằng chứng từ dữ liệu' })
  suggestions(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: SavingsSuggestionsRequestDto,
  ): Promise<SavingsSuggestionsDto> {
    return this.assistant.suggestions(current.id, dto);
  }

  @Post('scenario-explanation')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Hiểu kịch bản, chạy mô phỏng M2d và giải thích kết quả' })
  scenarioExplanation(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: SavingsScenarioRequestDto,
  ): Promise<SavingsScenarioExplanationDto> {
    return this.assistant.scenarioExplanation(current.id, dto);
  }

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @ApiOperation({ summary: 'Hỏi đáp về tiết kiệm (không lưu lịch sử, không ghi dữ liệu)' })
  chat(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: SavingsChatRequestDto,
  ): Promise<SavingsChatReplyDto> {
    return this.assistant.chat(current.id, dto);
  }
}
