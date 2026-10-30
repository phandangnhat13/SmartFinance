import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AiAssistantType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AI_CONVERSATION_TITLE_MAX_LENGTH,
  AI_MESSAGE_MAX_LENGTH,
} from '@smart-finance/shared-types';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateAiConversationDto {
  @ApiProperty({ enum: AiAssistantType })
  @IsEnum(AiAssistantType, { message: 'assistantType phải là SAVINGS hoặc ANALYTICS' })
  assistantType!: AiAssistantType;

  @ApiPropertyOptional({
    maxLength: AI_CONVERSATION_TITLE_MAX_LENGTH,
    description: 'Bỏ trống để đặt tiêu đề từ tin nhắn đầu tiên',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(1, AI_CONVERSATION_TITLE_MAX_LENGTH, {
    message: `title phải từ 1 đến ${AI_CONVERSATION_TITLE_MAX_LENGTH} ký tự`,
  })
  title?: string;
}

export class ListAiConversationsQuery {
  @ApiPropertyOptional({ maxLength: AI_CONVERSATION_TITLE_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(AI_CONVERSATION_TITLE_MAX_LENGTH, {
    message: `q tối đa ${AI_CONVERSATION_TITLE_MAX_LENGTH} ký tự`,
  })
  q?: string;

  @ApiPropertyOptional({ enum: AiAssistantType })
  @IsOptional()
  @IsEnum(AiAssistantType, { message: 'assistantType phải là SAVINGS hoặc ANALYTICS' })
  assistantType?: AiAssistantType;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class UpdateAiConversationDto {
  @ApiProperty({ maxLength: AI_CONVERSATION_TITLE_MAX_LENGTH })
  @Transform(trimmed)
  @IsString()
  @Length(1, AI_CONVERSATION_TITLE_MAX_LENGTH, {
    message: `title phải từ 1 đến ${AI_CONVERSATION_TITLE_MAX_LENGTH} ký tự`,
  })
  title!: string;
}

export class ListAiMessagesQuery {
  @ApiPropertyOptional({ default: 1, description: 'Trang 1 là các tin nhắn mới nhất' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SendAiMessageDto {
  @ApiProperty({ maxLength: AI_MESSAGE_MAX_LENGTH })
  @Transform(trimmed)
  @IsString()
  @Length(1, AI_MESSAGE_MAX_LENGTH, {
    message: `content phải từ 1 đến ${AI_MESSAGE_MAX_LENGTH} ký tự`,
  })
  content!: string;

  @ApiPropertyOptional({ example: 'VND', description: 'Mã tiền tệ 3 ký tự (tuỳ chọn)' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, { message: 'currency phải là mã 3 ký tự, ví dụ VND' })
  currency?: string;
}
