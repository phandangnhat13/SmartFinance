import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class FinancialHealthQuery {
  @ApiPropertyOptional({ example: 'VND', description: 'Mã tiền tệ 3 ký tự' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, { message: 'currency phải là mã 3 ký tự, ví dụ VND' })
  currency?: string;
}

export class FinancialHealthHistoryQuery extends FinancialHealthQuery {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 12,
    default: 6,
    description: 'Số tháng đã kết thúc cần tính lại điểm nhóm Dòng tiền và Ngân sách',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'months phải là số nguyên' })
  @Min(1, { message: 'months phải từ 1 đến 12' })
  @Max(12, { message: 'months phải từ 1 đến 12' })
  months?: number;
}
