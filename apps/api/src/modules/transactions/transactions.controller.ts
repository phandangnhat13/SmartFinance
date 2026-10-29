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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/auth-user.interface';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { ListTransactionsQuery } from './dto/list-transactions.query';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { toTransactionDto } from './transaction.mapper';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách giao dịch có lọc và phân trang' })
  async list(@CurrentUser() current: AuthenticatedUser, @Query() query: ListTransactionsQuery) {
    const result = await this.transactionsService.list(current.id, query);
    return {
      ...result,
      items: result.items.map(toTransactionDto),
    };
  }

  @Post()
  @ApiOperation({ summary: 'Tạo giao dịch thu nhập hoặc chi tiêu' })
  async create(@CurrentUser() current: AuthenticatedUser, @Body() dto: CreateTransactionDto) {
    const transaction = await this.transactionsService.create(current.id, dto);
    return { transaction: toTransactionDto(transaction) };
  }

  @Post('transfers')
  @ApiOperation({ summary: 'Tạo giao dịch chuyển tiền nội bộ (hai vế, nguyên tử)' })
  async createTransfer(@CurrentUser() current: AuthenticatedUser, @Body() dto: CreateTransferDto) {
    const [out, incoming] = await this.transactionsService.createTransfer(current.id, dto);
    return { transactions: [toTransactionDto(out), toTransactionDto(incoming)] };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết giao dịch' })
  async getOne(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const transaction = await this.transactionsService.getByIdOrThrow(current.id, id);
    return { transaction: toTransactionDto(transaction) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Sửa giao dịch thu nhập hoặc chi tiêu' })
  async update(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateTransactionDto,
  ) {
    const transaction = await this.transactionsService.update(current.id, id, dto);
    return { transaction: toTransactionDto(transaction) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xoá giao dịch (xoá cả hai vế nếu là chuyển tiền)' })
  async remove(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.transactionsService.remove(current.id, id);
    return { success: true };
  }
}
