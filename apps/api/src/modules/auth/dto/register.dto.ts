import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'an@example.com' })
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'S3curePassw0rd!', minLength: 8 })
  @IsString()
  @Length(8, 72, { message: 'Mật khẩu phải từ 8 đến 72 ký tự' })
  password!: string;

  @ApiPropertyOptional({ example: 'Nguyễn Văn An' })
  @IsOptional()
  @IsString()
  @Length(1, 80, { message: 'Tên hiển thị từ 1 đến 80 ký tự' })
  displayName?: string;
}
