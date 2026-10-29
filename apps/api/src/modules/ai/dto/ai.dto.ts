import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';

export class ClassifyItemDto {
  @ApiProperty({ example: 'GRAB TRIP HANOI' })
  @IsString()
  @Length(1, 500)
  description!: string;

  @ApiPropertyOptional({ enum: ['INCOME', 'EXPENSE'], default: 'EXPENSE' })
  @IsOptional()
  @IsIn(['INCOME', 'EXPENSE'])
  type?: 'INCOME' | 'EXPENSE';
}

export class ClassifyTransactionDto extends ClassifyItemDto {
  @ApiPropertyOptional({ description: 'Gắn dự đoán với giao dịch đã tồn tại' })
  @IsOptional()
  @IsUUID('4')
  transactionId?: string;
}

export class ClassifyBatchDto {
  @ApiProperty({ type: [ClassifyItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ClassifyItemDto)
  items!: ClassifyItemDto[];
}

export class PredictionFeedbackDto {
  @ApiProperty({ enum: ['ACCEPT', 'CORRECT', 'REJECT'] })
  @IsIn(['ACCEPT', 'CORRECT', 'REJECT'])
  action!: 'ACCEPT' | 'CORRECT' | 'REJECT';

  @ApiPropertyOptional({ description: 'Bắt buộc khi action = CORRECT' })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;
}
