import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/auth-user.interface';
import { AccountsService } from './accounts.service';
import { toAccountDto } from './account.mapper';
import { CreateAccountDto, UpdateAccountDto } from './dto/create-account.dto';

@ApiTags('accounts')
@UseGuards(JwtAuthGuard)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách tài khoản kèm số dư tính từ giao dịch' })
  async list(
    @CurrentUser() current: AuthenticatedUser,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const rows = await this.accountsService.list(current.id, includeArchived === 'true');
    const balances = await this.accountsService.computeBalances(
      current.id,
      rows.map((row) => row.id),
    );
    return {
      items: rows.map((account) =>
        toAccountDto(account, balances.get(account.id) ?? new Prisma.Decimal(0)),
      ),
    };
  }

  @Post()
  @ApiOperation({ summary: 'Tạo tài khoản tài chính' })
  async create(@CurrentUser() current: AuthenticatedUser, @Body() dto: CreateAccountDto) {
    const account = await this.accountsService.create(current.id, dto);
    return {
      account: toAccountDto(account, account.initialBalance),
    };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật hoặc lưu trữ tài khoản' })
  async update(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    const account = await this.accountsService.update(current.id, id, dto);
    const balances = await this.accountsService.computeBalances(current.id, [id]);
    return {
      account: toAccountDto(account, balances.get(id) ?? new Prisma.Decimal(0)),
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xoá tài khoản nếu chưa có giao dịch' })
  async remove(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.accountsService.remove(current.id, id);
    return { success: true };
  }
}
