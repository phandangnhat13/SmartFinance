import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

/** One currency per request; the AI layer never mixes currencies. */
class SavingsAiQueryDto {
  @ApiPropertyOptional({ example: 'VND', description: 'Mã tiền tệ 3 ký tự' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, { message: 'currency phải là mã 3 ký tự, ví dụ VND' })
  currency?: string;
}

export class SavingsExplainRequestDto extends SavingsAiQueryDto {}

export class SavingsSuggestionsRequestDto extends SavingsAiQueryDto {}

export class SavingsScenarioRequestDto extends SavingsAiQueryDto {
  @ApiProperty({
    example: 'Nếu tôi góp 2.000.000 ₫ mỗi tháng cho mục tiêu Du lịch thì sao?',
    maxLength: 500,
  })
  @IsString()
  @Length(3, 500, { message: 'message phải từ 3 đến 500 ký tự' })
  message!: string;
}

export class SavingsChatHistoryItemDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @Length(1, 1_000, { message: 'Nội dung tin nhắn tối đa 1000 ký tự' })
  content!: string;
}

export class SavingsChatRequestDto extends SavingsAiQueryDto {
  @ApiProperty({ example: 'Tại sao hệ thống đề xuất mức tiết kiệm này?', maxLength: 1000 })
  @IsString()
  @Length(1, 1_000, { message: 'message phải từ 1 đến 1000 ký tự' })
  message!: string;

  @ApiPropertyOptional({ type: [SavingsChatHistoryItemDto], description: 'Tối đa 10 tin nhắn' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'history tối đa 10 tin nhắn' })
  @ValidateNested({ each: true })
  @Type(() => SavingsChatHistoryItemDto)
  history?: SavingsChatHistoryItemDto[];
}
