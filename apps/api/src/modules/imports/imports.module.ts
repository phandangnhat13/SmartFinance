import { Module } from '@nestjs/common';
import { ExportsController } from './exports.controller';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  controllers: [ImportsController, ExportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
