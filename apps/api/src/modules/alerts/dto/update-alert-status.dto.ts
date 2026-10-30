import { ApiProperty } from '@nestjs/swagger';
import { SpendingAlertStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

/**
 * Only the status is accepted. With `forbidNonWhitelisted` in the global pipe,
 * a client that tries to send `dedupeKey`, `severity`, `transactionId` or
 * `userId` gets a 400 instead of having it silently ignored.
 */
export class UpdateAlertStatusDto {
  @ApiProperty({ enum: SpendingAlertStatus })
  @IsEnum(SpendingAlertStatus)
  status!: SpendingAlertStatus;
}
