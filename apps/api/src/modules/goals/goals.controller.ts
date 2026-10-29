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
import { CreateContributionDto, CreateGoalDto, UpdateGoalDto } from './dto/goal.dto';
import { toGoalDto } from './goal.mapper';
import { GoalsService } from './goals.service';

@ApiTags('goals')
@UseGuards(JwtAuthGuard)
@Controller('goals')
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách mục tiêu tiết kiệm và tiến độ' })
  async list(
    @CurrentUser() current: AuthenticatedUser,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const goals = await this.goalsService.list(current.id, includeArchived === 'true');
    return { items: goals.map(toGoalDto) };
  }

  @Post()
  @ApiOperation({ summary: 'Tạo mục tiêu tiết kiệm' })
  async create(@CurrentUser() current: AuthenticatedUser, @Body() dto: CreateGoalDto) {
    const goal = await this.goalsService.create(current.id, dto);
    return { goal: toGoalDto(goal) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật mục tiêu tiết kiệm' })
  async update(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateGoalDto,
  ) {
    const goal = await this.goalsService.update(current.id, id, dto);
    return { goal: toGoalDto(goal) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lưu trữ mục tiêu tiết kiệm' })
  async archive(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const goal = await this.goalsService.archive(current.id, id);
    return { goal: toGoalDto(goal) };
  }

  @Post(':id/contributions')
  @ApiOperation({ summary: 'Ghi nhận khoản đóng góp cho mục tiêu' })
  async contribute(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateContributionDto,
  ) {
    const goal = await this.goalsService.addContribution(current.id, id, dto);
    return { goal: toGoalDto(goal) };
  }
}
