import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Nguyễn Văn An' })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  displayName?: string;

  @ApiPropertyOptional({ example: 'Asia/Ho_Chi_Minh' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  timezone?: string;

  @ApiPropertyOptional({ example: 'VND' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'Tiền tệ phải là mã 3 ký tự, ví dụ VND' })
  defaultCurrency?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'Cho phép xuất mô tả giao dịch đã ẩn danh (không email/số điện thoại/số tài khoản) để cải thiện mô hình AI.',
  })
  @IsOptional()
  @IsBoolean()
  allowAiResearch?: boolean;
}
