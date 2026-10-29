import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { MONEY_REGEX } from '../../../common/utils/money';

export class CreateTransactionDto {
  @ApiProperty()
  @IsUUID('4', { message: 'accountId không hợp lệ' })
  accountId!: string;

  @ApiPropertyOptional({ description: 'Bắt buộc với INCOME/EXPENSE' })
  @IsOptional()
  @IsUUID('4', { message: 'categoryId không hợp lệ' })
  categoryId?: string;

  @ApiProperty({ enum: ['INCOME', 'EXPENSE'] })
  @IsIn(['INCOME', 'EXPENSE'], { message: 'Loại giao dịch phải là INCOME hoặc EXPENSE' })
  type!: 'INCOME' | 'EXPENSE';

  @ApiProperty({ example: '65000' })
  @Matches(MONEY_REGEX, {
    message: 'Số tiền phải lớn hơn 0 và có tối đa 2 chữ số thập phân',
  })
  amount!: string;

  @ApiProperty({ example: '2026-10-25T10:00:00+07:00' })
  @IsISO8601({ strict: true }, { message: 'Thời điểm giao dịch không hợp lệ' })
  occurredAt!: string;

  @ApiProperty({ example: 'Highlands Coffee' })
  @IsString()
  @Length(1, 500)
  description!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({ example: 'VND' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'Tiền tệ phải là mã 3 ký tự' })
  currency?: string;

  @ApiPropertyOptional({ description: 'Gắn kết quả AI đã đề xuất vào giao dịch' })
  @IsOptional()
  @IsUUID('4')
  aiPredictionId?: string;
}
