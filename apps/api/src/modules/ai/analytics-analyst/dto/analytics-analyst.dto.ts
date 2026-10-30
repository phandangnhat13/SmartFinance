import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * AI financial analyst requests (M3e).
 *
 * Every request names one currency and an optional trend window. There is
 * deliberately no `history` field: each question is answered on its own, so no
 * chat transcript is stored or forwarded by default.
 */
export class AnalyticsAiQueryDto {
  @ApiPropertyOptional({ example: 'VND', description: 'Mã tiền tệ 3 ký tự' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, { message: 'currency phải là mã 3 ký tự, ví dụ VND' })
  currency?: string;

  @ApiPropertyOptional({
    enum: [3, 6, 12, 24],
    default: 6,
    description: 'Số tháng của chuỗi xu hướng đưa vào ngữ cảnh',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'months phải là số nguyên' })
  @IsIn([3, 6, 12, 24], { message: 'months phải là 3, 6, 12 hoặc 24' })
  months?: number;
}

export class AnalyticsAiSummaryRequestDto extends AnalyticsAiQueryDto {}

export class AnalyticsAiExplainRequestDto extends AnalyticsAiQueryDto {
  @ApiPropertyOptional({
    example: 'Vì sao chi tiêu tháng này tăng?',
    maxLength: 500,
    description: 'Câu hỏi cần giải thích; bỏ trống để giải thích toàn bộ chỉ số',
  })
  @IsOptional()
  @IsString()
  @Length(3, 500, { message: 'question phải từ 3 đến 500 ký tự' })
  question?: string;
}

export class AnalyticsAiRecommendationsRequestDto extends AnalyticsAiQueryDto {}

export class AnalyticsAiChatRequestDto extends AnalyticsAiQueryDto {
  @ApiProperty({ example: 'Ngân sách nào đang vượt hạn mức?', maxLength: 1000 })
  @IsString()
  @Length(1, 1_000, { message: 'message phải từ 1 đến 1000 ký tự' })
  message!: string;
}
