import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { SimulationScenario } from '@smart-finance/shared-types';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { MONEY_REGEX } from '../../../common/utils/money';
import { DATE_ONLY_REGEX } from '../../../common/utils/period';
import { CURRENCY_REGEX } from '../../goals/dto/goal.dto';

const SIMULATION_SCENARIOS: SimulationScenario[] = [
  'MONTHLY_AMOUNT',
  'DEADLINE',
  'TARGET_AMOUNT',
  'MULTI_GOAL_BUDGET',
];

const toCurrencyCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class SavingsProgressQuery {
  @ApiPropertyOptional({ example: 'VND', description: 'Mặc định theo tiền tệ của người dùng' })
  @IsOptional()
  @Transform(toCurrencyCode)
  @Matches(CURRENCY_REGEX, { message: 'currency phải là mã 3 ký tự, ví dụ VND' })
  currency?: string;
}

export class ContributionHistoryQuery extends SavingsProgressQuery {
  @ApiPropertyOptional({ description: 'Chỉ lấy khoản góp của một mục tiêu' })
  @IsOptional()
  @IsUUID(undefined, { message: 'goalId phải là UUID hợp lệ' })
  goalId?: string;

  @ApiPropertyOptional({ example: 12, minimum: 1, maximum: 36 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'months phải là số nguyên' })
  @Min(1, { message: 'months phải từ 1 đến 36' })
  @Max(36, { message: 'months phải từ 1 đến 36' })
  months?: number;
}

export class SavingsSimulationInput {
  @ApiProperty({ enum: SIMULATION_SCENARIOS, example: 'MONTHLY_AMOUNT' })
  @IsIn(SIMULATION_SCENARIOS, { message: 'scenario không hợp lệ' })
  scenario!: SimulationScenario;

  @ApiPropertyOptional({ description: 'Mục tiêu cần mô phỏng (bắt buộc trừ kịch bản ngân sách)' })
  @IsOptional()
  @IsUUID(undefined, { message: 'goalId phải là UUID hợp lệ' })
  goalId?: string;

  @ApiPropertyOptional({ example: '3000000', description: 'Mức góp mỗi tháng giả định' })
  @IsOptional()
  @Matches(MONEY_REGEX, { message: 'Số tiền phải lớn hơn 0, tối đa 2 chữ số thập phân' })
  monthlyAmount?: string;

  @ApiPropertyOptional({ example: '25000000', description: 'Số tiền mục tiêu giả định' })
  @IsOptional()
  @Matches(MONEY_REGEX, { message: 'Số tiền phải lớn hơn 0, tối đa 2 chữ số thập phân' })
  targetAmount?: string;

  @ApiPropertyOptional({ example: '2027-06-30', description: 'Ngày đích giả định' })
  @IsOptional()
  @Matches(DATE_ONLY_REGEX, { message: 'Ngày đích phải có định dạng YYYY-MM-DD' })
  targetDate?: string;

  @ApiPropertyOptional({ example: '5000000', description: 'Ngân sách/tháng cho nhiều mục tiêu' })
  @IsOptional()
  @Matches(MONEY_REGEX, { message: 'Số tiền phải lớn hơn 0, tối đa 2 chữ số thập phân' })
  budget?: string;

  @ApiPropertyOptional({ example: 'VND', description: 'Chỉ dùng cho kịch bản nhiều mục tiêu' })
  @IsOptional()
  @Transform(toCurrencyCode)
  @Matches(CURRENCY_REGEX, { message: 'currency phải là mã 3 ký tự, ví dụ VND' })
  currency?: string;
}

/** The fields an adjustment may move. Nothing else is accepted. */
export class SavingsAdjustmentInput {
  @ApiProperty()
  @IsUUID(undefined, { message: 'goalId phải là UUID hợp lệ' })
  goalId!: string;

  @ApiPropertyOptional({ example: '25000000' })
  @IsOptional()
  @Matches(MONEY_REGEX, { message: 'Số tiền mục tiêu phải lớn hơn 0, tối đa 2 chữ số thập phân' })
  targetAmount?: string;

  @ApiPropertyOptional({ example: '2027-06-30' })
  @IsOptional()
  @Matches(DATE_ONLY_REGEX, { message: 'Ngày đích phải có định dạng YYYY-MM-DD' })
  targetDate?: string;
}
