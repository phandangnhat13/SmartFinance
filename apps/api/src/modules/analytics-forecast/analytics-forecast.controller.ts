import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/auth-user.interface';
import { AnalyticsForecastService } from './analytics-forecast.service';
import { ForecastQuery } from './dto/forecast.query';

/**
 * Financial forecasting (M3c). Read-only, statistical and computed on the
 * server from the signed-in user's own completed months. The figures are
 * estimates, never AI output and never actual transactions.
 */
@ApiTags('analytics')
@UseGuards(JwtAuthGuard)
@Controller('analytics/forecast')
export class AnalyticsForecastController {
  constructor(private readonly service: AnalyticsForecastService) {}

  @Get()
  @ApiOperation({
    summary: 'Dự báo thu nhập, chi tiêu, dòng tiền ròng và số dư cuối tháng',
  })
  forecast(@CurrentUser() current: AuthenticatedUser, @Query() query: ForecastQuery) {
    return this.service.forecast(current.id, query);
  }

  @Get('income')
  @ApiOperation({ summary: 'Dự báo thu nhập theo mô hình thống kê và dữ liệu quá khứ' })
  income(@CurrentUser() current: AuthenticatedUser, @Query() query: ForecastQuery) {
    return this.service.income(current.id, query);
  }

  @Get('expenses')
  @ApiOperation({ summary: 'Dự báo chi tiêu tổng và theo danh mục đủ dữ liệu' })
  expenses(@CurrentUser() current: AuthenticatedUser, @Query() query: ForecastQuery) {
    return this.service.expenses(current.id, query);
  }

  @Get('cash-flow')
  @ApiOperation({ summary: 'Dự báo dòng tiền ròng và số dư cuối tháng hiện tại' })
  cashFlow(@CurrentUser() current: AuthenticatedUser, @Query() query: ForecastQuery) {
    return this.service.cashFlow(current.id, query);
  }
}
