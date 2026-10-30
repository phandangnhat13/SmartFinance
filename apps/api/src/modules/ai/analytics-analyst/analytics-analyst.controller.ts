import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type {
  AnalyticsAiChatReplyDto,
  AnalyticsAiExplanationDto,
  AnalyticsAiRecommendationsDto,
  AnalyticsAiSummaryDto,
} from '@smart-finance/shared-types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/auth-user.interface';
import { AnalyticsAnalystService } from './analytics-analyst.service';
import {
  AnalyticsAiChatRequestDto,
  AnalyticsAiExplainRequestDto,
  AnalyticsAiRecommendationsRequestDto,
  AnalyticsAiSummaryRequestDto,
} from './dto/analytics-analyst.dto';

/**
 * AI financial analyst endpoints (M3e).
 *
 * Every handler is authenticated, scopes all data to `current.id`, and is
 * read-only: no route here can create, update or delete a transaction, budget,
 * goal, contribution or balance. Requests carry a single question — there is no
 * history field, so no transcript is stored or sent.
 */
@ApiTags('ai')
@UseGuards(JwtAuthGuard)
@Controller('ai/analytics')
export class AnalyticsAnalystController {
  constructor(private readonly analyst: AnalyticsAnalystService) {}

  @Post('summary')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Tóm tắt tình hình tài chính từ số liệu hệ thống đã tính' })
  summary(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: AnalyticsAiSummaryRequestDto,
  ): Promise<AnalyticsAiSummaryDto> {
    return this.analyst.summary(current.id, dto);
  }

  @Post('explain')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Giải thích chỉ số phân tích, dự báo và điểm sức khỏe' })
  explain(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: AnalyticsAiExplainRequestDto,
  ): Promise<AnalyticsAiExplanationDto> {
    return this.analyst.explain(current.id, dto);
  }

  @Post('recommendations')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Gợi ý hành động kèm bằng chứng; không tự thay đổi dữ liệu' })
  recommendations(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: AnalyticsAiRecommendationsRequestDto,
  ): Promise<AnalyticsAiRecommendationsDto> {
    return this.analyst.recommendations(current.id, dto);
  }

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @ApiOperation({ summary: 'Hỏi đáp tiếng Việt (không lưu lịch sử, không ghi dữ liệu)' })
  chat(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: AnalyticsAiChatRequestDto,
  ): Promise<AnalyticsAiChatReplyDto> {
    return this.analyst.chat(current.id, dto);
  }
}
