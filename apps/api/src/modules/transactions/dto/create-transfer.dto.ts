import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { MONEY_REGEX } from '../../../common/utils/money';

export class CreateTransferDto {
  @ApiProperty()
  @IsUUID('4', { message: 'Tài khoản nguồn không hợp lệ' })
  fromAccountId!: string;

  @ApiProperty()
  @IsUUID('4', { message: 'Tài khoản đích không hợp lệ' })
  toAccountId!: string;

  @ApiProperty({ example: '300000' })
  @Matches(MONEY_REGEX, {
    message: 'Số tiền phải lớn hơn 0 và có tối đa 2 chữ số thập phân',
  })
  amount!: string;

  @ApiProperty({ example: '2026-10-25T10:00:00+07:00' })
  @IsISO8601({ strict: true }, { message: 'Thời điểm giao dịch không hợp lệ' })
  occurredAt!: string;

  @ApiPropertyOptional({ example: 'Chuyển tiền nội bộ' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
