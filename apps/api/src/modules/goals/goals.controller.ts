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
import {
  CreateContributionDto,
  CreateGoalDto,
  ListGoalsQuery,
  UpdateContributionDto,
  UpdateGoalDto,
} from './dto/goal.dto';
import { GoalsService } from './goals.service';

@ApiTags('goals')
@UseGuards(JwtAuthGuard)
@Controller('goals')
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách mục tiêu tiết kiệm và tiến độ' })
  async list(@CurrentUser() current: AuthenticatedUser, @Query() query: ListGoalsQuery) {
    const items = await this.goalsService.list(current.id, {
      includeArchived: query.includeArchived === 'true',
      currency: query.currency,
    });
    return { items };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết một mục tiêu tiết kiệm' })
  async get(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return { goal: await this.goalsService.get(current.id, id) };
  }

  @Post()
  @ApiOperation({ summary: 'Tạo mục tiêu tiết kiệm' })
  async create(@CurrentUser() current: AuthenticatedUser, @Body() dto: CreateGoalDto) {
    return { goal: await this.goalsService.create(current.id, dto) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật mục tiêu tiết kiệm' })
  async update(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateGoalDto,
  ) {
    return { goal: await this.goalsService.update(current.id, id, dto) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lưu trữ mục tiêu tiết kiệm' })
  async archive(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return { goal: await this.goalsService.archive(current.id, id) };
  }

  @Post(':id/contributions')
  @ApiOperation({ summary: 'Ghi nhận khoản đóng góp cho mục tiêu' })
  async contribute(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateContributionDto,
  ) {
    return { goal: await this.goalsService.addContribution(current.id, id, dto) };
  }

  @Patch(':id/contributions/:contributionId')
  @ApiOperation({ summary: 'Sửa một khoản đóng góp đã ghi nhận' })
  async updateContribution(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('contributionId', new ParseUUIDPipe()) contributionId: string,
    @Body() dto: UpdateContributionDto,
  ) {
    return {
      goal: await this.goalsService.updateContribution(current.id, id, contributionId, dto),
    };
  }

  @Delete(':id/contributions/:contributionId')
  @ApiOperation({ summary: 'Xóa một khoản đóng góp đã ghi nhận' })
  async deleteContribution(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('contributionId', new ParseUUIDPipe()) contributionId: string,
  ) {
    return { goal: await this.goalsService.deleteContribution(current.id, id, contributionId) };
  }
}
