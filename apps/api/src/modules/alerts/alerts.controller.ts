import {
  Body,
  Controller,
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
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/auth-user.interface';
import { toSpendingAlertDto } from './alert.mapper';
import { AlertScanService } from './alert-scan.service';
import { AlertsService } from './alerts.service';
import { ListAlertsQuery } from './dto/list-alerts.query';
import { UpdateAlertStatusDto } from './dto/update-alert-status.dto';

/** A scan is heavier than a normal read, so it is limited separately. */
export const ALERT_SCAN_RATE_LIMIT = { limit: 20, ttl: 60_000 } as const;

@ApiTags('alerts')
@UseGuards(JwtAuthGuard)
@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly alertsService: AlertsService,
    private readonly scanService: AlertScanService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách cảnh báo chi tiêu bất thường của người dùng' })
  async list(@CurrentUser() current: AuthenticatedUser, @Query() query: ListAlertsQuery) {
    const result = await this.alertsService.list(current.id, query);
    return {
      ...result,
      items: result.items.map(toSpendingAlertDto),
    };
  }

  @Post('scan')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: ALERT_SCAN_RATE_LIMIT.limit, ttl: ALERT_SCAN_RATE_LIMIT.ttl } })
  @ApiOperation({ summary: 'Quét giao dịch để phát hiện chi tiêu bất thường (idempotent)' })
  async scan(@CurrentUser() current: AuthenticatedUser) {
    return { scan: await this.scanService.scan(current.id) };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Xác nhận, bỏ qua hoặc đánh dấu bình thường một cảnh báo' })
  async updateStatus(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAlertStatusDto,
  ) {
    const alert = await this.alertsService.updateStatus(current.id, id, dto.status);
    return { alert: toSpendingAlertDto(alert) };
  }
}
