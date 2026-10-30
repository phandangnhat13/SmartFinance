import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GoalStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { MONEY_REGEX } from '../../../common/utils/money';
import { DATE_ONLY_REGEX } from '../../../common/utils/period';

export const CURRENCY_REGEX = /^[A-Z]{3}$/;

const toCurrencyCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class ListGoalsQuery {
  @ApiPropertyOptional({ description: 'Bao gồm cả mục tiêu đã lưu trữ' })
  @IsOptional()
  @Matches(/^(true|false)$/, { message: 'includeArchived phải là true hoặc false' })
  includeArchived?: string;

  @ApiPropertyOptional({ example: 'VND' })
  @IsOptional()
  @Transform(toCurrencyCode)
  @Matches(CURRENCY_REGEX, { message: 'currency phải là mã 3 ký tự, ví dụ VND' })
  currency?: string;
}

export class CreateGoalDto {
  @ApiProperty({ example: 'Mua laptop mới' })
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiPropertyOptional({ example: 'Laptop cho công việc' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: '25000000' })
  @Matches(MONEY_REGEX, {
    message: 'Số tiền mục tiêu phải lớn hơn 0, tối đa 2 chữ số thập phân',
  })
  targetAmount!: string;

  @ApiPropertyOptional({ example: 'VND', description: 'Mặc định theo tiền tệ của người dùng' })
  @IsOptional()
  @Transform(toCurrencyCode)
  @Matches(CURRENCY_REGEX, { message: 'currency phải là mã 3 ký tự, ví dụ VND' })
  currency?: string;

  @ApiPropertyOptional({ example: '2026-11-01', description: 'Mặc định là hôm nay' })
  @IsOptional()
  @Matches(DATE_ONLY_REGEX, { message: 'Ngày bắt đầu phải có định dạng YYYY-MM-DD' })
  startDate?: string;

  @ApiPropertyOptional({ example: '2027-06-30' })
  @IsOptional()
  @Matches(DATE_ONLY_REGEX, { message: 'Ngày đích phải có định dạng YYYY-MM-DD' })
  targetDate?: string;
}

export class UpdateGoalDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(MONEY_REGEX, {
    message: 'Số tiền mục tiêu phải lớn hơn 0, tối đa 2 chữ số thập phân',
  })
  targetAmount?: string;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @Matches(DATE_ONLY_REGEX, { message: 'Ngày bắt đầu phải có định dạng YYYY-MM-DD' })
  startDate?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(DATE_ONLY_REGEX, { message: 'Ngày đích phải có định dạng YYYY-MM-DD' })
  targetDate?: string;

  @ApiPropertyOptional({ enum: GoalStatus })
  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;
}

export class CreateContributionDto {
  @ApiProperty({ example: '2000000' })
  @Matches(MONEY_REGEX, {
    message: 'Số tiền đóng góp phải lớn hơn 0, tối đa 2 chữ số thập phân',
  })
  amount!: string;

  @ApiProperty({ example: '2026-10-25T10:00:00+07:00' })
  @IsISO8601({ strict: true })
  contributedAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateContributionDto {
  @ApiPropertyOptional({ example: '2500000' })
  @IsOptional()
  @Matches(MONEY_REGEX, {
    message: 'Số tiền đóng góp phải lớn hơn 0, tối đa 2 chữ số thập phân',
  })
  amount?: string;

  @ApiPropertyOptional({ example: '2026-10-25T10:00:00+07:00' })
  @IsOptional()
  @IsISO8601({ strict: true })
  contributedAt?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
