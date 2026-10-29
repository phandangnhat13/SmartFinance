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
import { BudgetsService } from './budgets.service';
import { CreateBudgetDto, ListBudgetsQuery, UpdateBudgetDto } from './dto/budget.dto';

@ApiTags('budgets')
@UseGuards(JwtAuthGuard)
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách ngân sách của tháng kèm tiến độ' })
  async list(@CurrentUser() current: AuthenticatedUser, @Query() query: ListBudgetsQuery) {
    const items = await this.budgetsService.list(current.id, query.month);
    return { items };
  }

  @Post()
  @ApiOperation({ summary: 'Tạo ngân sách tháng' })
  async create(@CurrentUser() current: AuthenticatedUser, @Body() dto: CreateBudgetDto) {
    const budget = await this.budgetsService.create(current.id, dto);
    const progress = await this.budgetsService.buildProgress(
      budget,
      await this.budgetsService.getTimezone(current.id),
    );
    return { budget: progress };
  }

  @Get(':id/progress')
  @ApiOperation({ summary: 'Tiến độ ngân sách' })
  async progress(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return { budget: await this.budgetsService.getProgress(current.id, id) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật ngân sách' })
  async update(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateBudgetDto,
  ) {
    const budget = await this.budgetsService.update(current.id, id, dto);
    const progress = await this.budgetsService.buildProgress(
      budget,
      await this.budgetsService.getTimezone(current.id),
    );
    return { budget: progress };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xoá ngân sách' })
  async remove(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.budgetsService.remove(current.id, id);
    return { success: true };
  }
}
