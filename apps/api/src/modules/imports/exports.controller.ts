import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/auth-user.interface';
import { ExportTransactionsQuery } from './dto/export.query';
import { ImportsService } from './imports.service';

@ApiTags('exports')
@UseGuards(JwtAuthGuard)
@Controller('exports')
export class ExportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Get('transactions.csv')
  @ApiOperation({ summary: 'Xuất giao dịch theo bộ lọc ra CSV (chống formula injection)' })
  async transactions(
    @CurrentUser() current: AuthenticatedUser,
    @Query() query: ExportTransactionsQuery,
    @Res() response: Response,
  ): Promise<void> {
    const { csv, fileName } = await this.importsService.exportCsv(current.id, query);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.send(csv);
  }
}
