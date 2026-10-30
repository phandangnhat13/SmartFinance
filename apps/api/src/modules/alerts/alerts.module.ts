import { Module } from '@nestjs/common';
import { AlertScanService } from './alert-scan.service';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

@Module({
  controllers: [AlertsController],
  providers: [AlertsService, AlertScanService],
})
export class AlertsModule {}
