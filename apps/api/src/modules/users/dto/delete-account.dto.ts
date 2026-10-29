import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class DeleteAccountDto {
  @ApiProperty({ description: 'Mật khẩu hiện tại để xác nhận xoá tài khoản' })
  @IsString()
  @MaxLength(72)
  password!: string;
}
