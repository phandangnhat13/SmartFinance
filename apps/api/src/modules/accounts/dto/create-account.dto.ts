import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { AccountType } from '@prisma/client';
import { MONEY_REGEX } from '../../../common/utils/money';

export class CreateAccountDto {
  @ApiProperty({ example: 'Vietcombank' })
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiProperty({ enum: AccountType, example: AccountType.BANK })
  @IsEnum(AccountType)
  type!: AccountType;

  @ApiPropertyOptional({ example: '5000000', description: 'Số dư ban đầu' })
  @IsOptional()
  @Matches(MONEY_REGEX, { message: 'Số dư ban đầu không hợp lệ (tối đa 2 chữ số thập phân)' })
  initialBalance?: string;

  @ApiPropertyOptional({ example: 'VND' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'Tiền tệ phải là mã 3 ký tự, ví dụ VND' })
  currency?: string;
}

export class UpdateAccountDto extends PartialType(CreateAccountDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}
