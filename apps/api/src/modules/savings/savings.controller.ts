import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/auth-user.interface';
import {
  ContributionHistoryQuery,
  SavingsAdjustmentInput,
  SavingsProgressQuery,
  SavingsSimulationInput,
} from './dto/savings.dto';
import { SavingsPlanService } from './savings-plan.service';
import { SavingsProgressService } from './savings-progress.service';

/**
 * Savings progress, contribution history and read-only plan simulations.
 *
 * Every route is scoped to the signed-in user by the service layer; nothing
 * here accepts a userId from the client. Only `adjustments/apply` writes, and
 * only after the same validation as the goals API.
 */
@ApiTags('savings')
@UseGuards(JwtAuthGuard)
@Controller('savings')
export class SavingsController {
  constructor(
    private readonly progressService: SavingsProgressService,
    private readonly planService: SavingsPlanService,
  ) {}

  @Get('progress')
  @ApiOperation({ summary: 'Tổng quan tiến độ tiết kiệm và tiến độ từng mục tiêu' })
  progress(@CurrentUser() current: AuthenticatedUser, @Query() query: SavingsProgressQuery) {
    return this.progressService.progress(current.id, query);
  }

  @Get('progress/:goalId')
  @ApiOperation({ summary: 'Tiến độ chi tiết của một mục tiêu tiết kiệm' })
  goalProgress(
    @CurrentUser() current: AuthenticatedUser,
    @Param('goalId', new ParseUUIDPipe()) goalId: string,
  ) {
    return this.progressService.goalProgress(current.id, goalId);
  }

  @Get('contribution-history')
  @ApiOperation({ summary: 'Lịch sử khoản góp và tổng theo từng tháng' })
  contributionHistory(
    @CurrentUser() current: AuthenticatedUser,
    @Query() query: ContributionHistoryQuery,
  ) {
    return this.progressService.contributionHistory(current.id, query);
  }

  @Post('simulations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mô phỏng kế hoạch tiết kiệm (chỉ đọc, không ghi dữ liệu)' })
  simulate(@CurrentUser() current: AuthenticatedUser, @Body() dto: SavingsSimulationInput) {
    return this.planService.simulate(current.id, dto);
  }

  @Post('adjustments/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xem trước thay đổi mục tiêu trước khi áp dụng' })
  previewAdjustment(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: SavingsAdjustmentInput,
  ) {
    return this.planService.previewAdjustment(current.id, dto);
  }

  @Post('adjustments/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Áp dụng thay đổi mục tiêu sau khi người dùng xác nhận' })
  applyAdjustment(@CurrentUser() current: AuthenticatedUser, @Body() dto: SavingsAdjustmentInput) {
    return this.planService.applyAdjustment(current.id, dto);
  }
}
