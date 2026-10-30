import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type {
  AiConversationDto,
  AiConversationListDto,
  AiMessageListDto,
  SendAiMessageResponseDto,
} from '@smart-finance/shared-types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/auth-user.interface';
import { AiConversationsService } from './ai-conversations.service';
import {
  CreateAiConversationDto,
  ListAiConversationsQuery,
  ListAiMessagesQuery,
  SendAiMessageDto,
  UpdateAiConversationDto,
} from './dto/conversations.dto';

/**
 * Persistent AI chat shared by the savings assistant and the analytics
 * analyst.
 *
 * Every route is authenticated and scoped to `current.id`; the conversation id
 * is never trusted on its own, so another account's transcript is not
 * reachable. Chat is read-only: sending a message stores chat turns, never
 * financial data, and every financial value still comes from the deterministic
 * services behind the assistant.
 */
@ApiTags('ai')
@UseGuards(JwtAuthGuard)
@Controller('ai/conversations')
export class AiConversationsController {
  constructor(private readonly conversations: AiConversationsService) {}

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Tạo cuộc trò chuyện AI mới' })
  create(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: CreateAiConversationDto,
  ): Promise<AiConversationDto> {
    return this.conversations.create(current.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Liệt kê cuộc trò chuyện, mới nhất trước; tìm theo tiêu đề' })
  list(
    @CurrentUser() current: AuthenticatedUser,
    @Query() query: ListAiConversationsQuery,
  ): Promise<AiConversationListDto> {
    return this.conversations.list(current.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Xem một cuộc trò chuyện thuộc tài khoản hiện tại' })
  getOne(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AiConversationDto> {
    return this.conversations.getOne(current.id, id);
  }

  @Patch(':id')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Đổi tên cuộc trò chuyện' })
  rename(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAiConversationDto,
  ): Promise<AiConversationDto> {
    return this.conversations.rename(current.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Xoá cuộc trò chuyện cùng toàn bộ tin nhắn' })
  async remove(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.conversations.remove(current.id, id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Tin nhắn theo trang; trang 1 là các tin nhắn mới nhất' })
  messages(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListAiMessagesQuery,
  ): Promise<AiMessageListDto> {
    return this.conversations.listMessages(current.id, id, query);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @ApiOperation({ summary: 'Gửi tin nhắn, gọi trợ lý tương ứng và lưu cả hai lượt' })
  send(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendAiMessageDto,
  ): Promise<SendAiMessageResponseDto> {
    return this.conversations.sendMessage(current.id, id, dto);
  }
}
