import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/auth-user.interface';
import { FinancialHealthHistoryQuery, FinancialHealthQuery } from './dto/financial-health.query';
import { FinancialHealthService } from './financial-health.service';

/**
 * Financial health score (M3d). Read-only and deterministic: the score is a
 * rule-based indicator, never AI output and never a credit score. It never
 * creates a transaction or changes a budget/goal.
 */
@ApiTags('analytics')
@UseGuards(JwtAuthGuard)
@Controller('analytics/financial-health')
export class FinancialHealthController {
  constructor(private readonly service: FinancialHealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Điểm sức khỏe tài chính theo 5 nhóm với bằng chứng và khuyến nghị',
  })
  health(@CurrentUser() current: AuthenticatedUser, @Query() query: FinancialHealthQuery) {
    return this.service.health(current.id, query);
  }

  @Get('breakdown')
  @ApiOperation({ summary: 'Phân rã điểm: trọng số, đóng góp từng nhóm và dữ liệu còn thiếu' })
  breakdown(@CurrentUser() current: AuthenticatedUser, @Query() query: FinancialHealthQuery) {
    return this.service.breakdown(current.id, query);
  }

  @Get('history')
  @ApiOperation({
    summary: 'Điểm nhóm Dòng tiền và Ngân sách được tính lại cho các tháng đã kết thúc',
  })
  history(@CurrentUser() current: AuthenticatedUser, @Query() query: FinancialHealthHistoryQuery) {
    return this.service.history(current.id, query);
  }
}
