import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { MONEY_REGEX } from '../../../common/utils/money';
import { MONTH_REGEX } from '../../../common/utils/period';

export class CreateBudgetDto {
  @ApiProperty({ example: 'Ngân sách ăn uống tháng 10' })
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiPropertyOptional({ description: 'Bỏ trống để tạo ngân sách tổng' })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiProperty({ example: '2026-10' })
  @Matches(MONTH_REGEX, { message: 'Tháng phải có định dạng YYYY-MM' })
  month!: string;

  @ApiProperty({ example: '3000000' })
  @Matches(MONEY_REGEX, { message: 'Hạn mức phải là số dương, tối đa 2 chữ số thập phân' })
  limitAmount!: string;

  @ApiPropertyOptional({ example: [80, 100] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(5)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(200, { each: true })
  warningThresholds?: number[];
}

export class UpdateBudgetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(MONEY_REGEX, { message: 'Hạn mức phải là số dương, tối đa 2 chữ số thập phân' })
  limitAmount?: string;

  @ApiPropertyOptional({ example: [80, 100] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(5)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(200, { each: true })
  warningThresholds?: number[];
}

export class ListBudgetsQuery {
  @ApiPropertyOptional({ example: '2026-10' })
  @IsOptional()
  @Matches(MONTH_REGEX, { message: 'Tháng phải có định dạng YYYY-MM' })
  month?: string;
}
