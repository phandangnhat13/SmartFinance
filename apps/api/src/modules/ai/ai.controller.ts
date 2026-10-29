import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AiSuggestionDto } from '@smart-finance/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/auth-user.interface';
import { AiService } from './ai.service';
import { ClassifyBatchDto, ClassifyTransactionDto, PredictionFeedbackDto } from './dto/ai.dto';

@ApiTags('ai')
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('classify-transaction')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Đề xuất danh mục từ mô tả giao dịch' })
  async classify(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: ClassifyTransactionDto,
  ): Promise<AiSuggestionDto> {
    return this.aiService.classify(current.id, dto);
  }

  @Post('classify-batch')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Đề xuất danh mục cho tối đa 50 mô tả' })
  async classifyBatch(@CurrentUser() current: AuthenticatedUser, @Body() dto: ClassifyBatchDto) {
    const items = await this.aiService.classifyBatch(current.id, dto.items);
    return { items };
  }

  @Post('predictions/:id/feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Chấp nhận, chỉnh sửa hoặc từ chối kết quả AI' })
  async feedback(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PredictionFeedbackDto,
  ) {
    const prediction = await this.aiService.feedback(current.id, id, dto);
    return {
      prediction: {
        id: prediction.id,
        status: prediction.status,
        acceptedCategoryId: prediction.acceptedCategoryId,
      },
    };
  }

  @Delete('predictions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xóa một kết quả dự đoán AI của chính bạn' })
  async deletePrediction(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.aiService.deletePrediction(current.id, id);
  }

  @Get('model-info')
  @ApiOperation({ summary: 'Thông tin và trạng thái mô hình AI' })
  modelInfo() {
    return this.aiService.modelInfo();
  }
}
