import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ACCESS_TOKEN_COOKIE, JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/auth-user.interface';
import { toUserDto } from '../users/user.mapper';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Đăng ký tài khoản bằng email và mật khẩu' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) response: Response) {
    const user = await this.authService.register(dto);
    const token = await this.authService.issueAccessToken(user);
    this.setAuthCookie(response, token);
    return { user: toUserDto(user) };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Đăng nhập' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const user = await this.authService.validateCredentials(dto);
    const token = await this.authService.issueAccessToken(user);
    this.setAuthCookie(response, token);
    return { user: toUserDto(user) };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng xuất và xoá cookie phiên' })
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(ACCESS_TOKEN_COOKIE, this.cookieOptions());
    return { success: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Lấy người dùng hiện tại' })
  async me(@CurrentUser() current: AuthenticatedUser) {
    const user = await this.usersService.getByIdOrThrow(current.id);
    return { user: toUserDto(user) };
  }

  private setAuthCookie(response: Response, token: string): void {
    response.cookie(ACCESS_TOKEN_COOKIE, token, {
      ...this.cookieOptions(),
      maxAge: this.authService.accessTokenTtlSeconds() * 1000,
    });
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.configService.get<string>('COOKIE_SECURE') === 'true',
      sameSite: 'lax' as const,
      path: '/',
    };
  }
}
