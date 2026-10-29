import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ACCESS_TOKEN_COOKIE, JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/auth-user.interface';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { toUserDto } from './user.mapper';
import { UsersService } from './users.service';

@ApiTags('users')
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Lấy hồ sơ cá nhân' })
  async me(@CurrentUser() current: AuthenticatedUser) {
    const user = await this.usersService.getByIdOrThrow(current.id);
    return { user: toUserDto(user) };
  }

  @Patch('me')
  @ApiOperation({ summary: 'Cập nhật hồ sơ cơ bản' })
  async update(@CurrentUser() current: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    const user = await this.usersService.updateProfile(current.id, dto);
    return { user: toUserDto(user) };
  }

  @Get('me/export')
  @ApiOperation({ summary: 'Xuất toàn bộ dữ liệu cá nhân dạng JSON' })
  async export(@CurrentUser() current: AuthenticatedUser) {
    return this.usersService.exportData(current.id);
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xoá tài khoản và toàn bộ dữ liệu cá nhân' })
  async remove(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.usersService.deleteAccount(current.id, dto.password);
    response.clearCookie(ACCESS_TOKEN_COOKIE, {
      httpOnly: true,
      secure: this.configService.get<string>('COOKIE_SECURE') === 'true',
      sameSite: 'lax',
      path: '/',
    });
    return { success: true };
  }
}
