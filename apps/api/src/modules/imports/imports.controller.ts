import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/auth-user.interface';
import { CSV_TEMPLATE } from './csv.util';
import { ImportsService } from './imports.service';

@ApiTags('imports')
@UseGuards(JwtAuthGuard)
@Controller('imports')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('csv')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2_000_000 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({ summary: 'Tải CSV, kiểm tra từng dòng và trả bản xem trước' })
  async upload(
    @CurrentUser() current: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.importsService.preview(current.id, file);
  }

  @Get('template.csv')
  @ApiOperation({ summary: 'Tải template CSV mẫu' })
  template(@Res() response: Response): void {
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="smart-finance-import-template.csv"',
    );
    response.send(`\uFEFF${CSV_TEMPLATE}`);
  }

  @Get()
  @ApiOperation({ summary: 'Lịch sử import' })
  async list(@CurrentUser() current: AuthenticatedUser) {
    const items = await this.importsService.list(current.id);
    return { items };
  }

  @Get(':id/preview')
  @ApiOperation({ summary: 'Xem lại bản preview của một phiên import' })
  async preview(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.importsService.getPreview(current.id, id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Trạng thái phiên import' })
  async getOne(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const result = await this.importsService.getPreview(current.id, id);
    return { batch: result.batch };
  }

  @Post(':id/commit')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Xác nhận nhập các dòng hợp lệ' })
  async commit(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const batch = await this.importsService.commit(current.id, id);
    return { batch };
  }
}
