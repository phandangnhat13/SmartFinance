import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'an@example.com' })
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'S3curePassw0rd!' })
  @IsString()
  @MaxLength(72)
  password!: string;
}
