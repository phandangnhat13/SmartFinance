import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AI_CONFIDENCE_THRESHOLD,
  AI_TAXONOMY,
  type AiSuggestionDto,
} from '@smart-finance/shared-types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CategoriesService } from '../categories/categories.service';
import { ClassifyItemDto, ClassifyTransactionDto, PredictionFeedbackDto } from './dto/ai.dto';
import { AI_PROVIDER, AiProvider, RawClassification } from './ai.provider';

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categoriesService: CategoriesService,
    private readonly configService: ConfigService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}

  async classify(userId: string, dto: ClassifyTransactionDto): Promise<AiSuggestionDto> {
    if (dto.transactionId) {
      const transaction = await this.prisma.transaction.findFirst({
        where: { id: dto.transactionId, userId },
        select: { id: true },
      });
      if (!transaction) throw new BadRequestException('Giao dịch không hợp lệ');
    }
    const input = {
      description: dto.description.trim(),
      type: dto.type ?? ('EXPENSE' as const),
    };
    try {
      const raw = await this.provider.classify(input);
      return this.resolveAndPersist(userId, input, raw, dto.transactionId);
    } catch {
      return this.modelNotReady();
    }
  }

  async classifyBatch(userId: string, items: ClassifyItemDto[]): Promise<AiSuggestionDto[]> {
    const inputs = items.map((item) => ({
      description: item.description.trim(),
      type: item.type ?? ('EXPENSE' as const),
    }));
    try {
      const raw = await this.provider.classifyBatch(inputs);
      const results: AiSuggestionDto[] = [];
      for (let index = 0; index < inputs.length; index += 1) {
        const classification = raw[index];
        results.push(
          classification
            ? await this.resolveAndPersist(userId, inputs[index]!, classification)
            : this.modelNotReady(),
        );
      }
      return results;
    } catch {
      return inputs.map(() => this.modelNotReady());
    }
  }

  async feedback(userId: string, predictionId: string, dto: PredictionFeedbackDto) {
    const prediction = await this.prisma.aiPrediction.findFirst({
      where: { id: predictionId, userId },
    });
    if (!prediction) throw new NotFoundException('Không tìm thấy kết quả dự đoán');

    if (dto.action === 'ACCEPT') {
      if (!prediction.predictedCategoryId) {
        throw new BadRequestException('Dự đoán không có danh mục hợp lệ để chấp nhận');
      }
      return this.prisma.aiPrediction.update({
        where: { id: predictionId },
        data: { status: 'ACCEPTED', acceptedCategoryId: prediction.predictedCategoryId },
      });
    }

    if (dto.action === 'CORRECT') {
      if (!dto.categoryId) {
        throw new BadRequestException('Cần chọn danh mục khi chỉnh sửa dự đoán');
      }
      await this.categoriesService.getAccessibleOrThrow(userId, dto.categoryId);
      return this.prisma.aiPrediction.update({
        where: { id: predictionId },
        data: { status: 'CORRECTED', acceptedCategoryId: dto.categoryId },
      });
    }

    return this.prisma.aiPrediction.update({
      where: { id: predictionId },
      data: { status: 'REJECTED', acceptedCategoryId: null },
    });
  }

  async modelInfo() {
    const info = await this.provider.modelInfo();
    if (!info) {
      return {
        status: 'model_not_ready',
        message: 'AI Service chưa sẵn sàng. Bạn vẫn có thể chọn danh mục thủ công.',
      };
    }
    return { status: 'ok', ...info };
  }

  private async resolveAndPersist(
    userId: string,
    input: { description: string; type: 'INCOME' | 'EXPENSE' },
    raw: RawClassification,
    transactionId?: string,
  ): Promise<AiSuggestionDto> {
    const modelName = (raw.modelName ?? 'tfidf-char-logreg').slice(0, 80);
    const modelVersion = (
      raw.modelVersion ?? this.configService.get<string>('AI_MODEL_VERSION', 'tfidf-char-lr-v2')
    ).slice(0, 80);

    const label = raw.label
      ? AI_TAXONOMY.find(
          (candidate) => candidate.slug === raw.label && candidate.type === input.type,
        )
      : undefined;

    if (!label) {
      const confidence = this.clampConfidence(raw.confidence);
      await this.prisma.aiPrediction.create({
        data: {
          userId,
          transactionId: transactionId ?? null,
          inputDescription: input.description.slice(0, 500),
          modelName,
          modelVersion,
          predictedSlug: raw.label ? raw.label.slice(0, 64) : null,
          confidence,
          status: 'SUGGESTED',
        },
      });
      return {
        categoryId: null,
        categoryName: null,
        slug: null,
        confidence,
        status: raw.label ? 'invalid_label' : 'model_not_ready',
        predictionId: null,
        modelVersion,
        message: raw.label
          ? 'Mô hình trả về danh mục không hợp lệ. Vui lòng chọn danh mục thủ công.'
          : 'Mô hình chưa sẵn sàng. Vui lòng chọn danh mục thủ công.',
      };
    }

    const category = await this.prisma.category.findFirst({
      where: { slug: label.slug, isSystem: true, isArchived: false },
    });
    if (!category) {
      return {
        categoryId: null,
        categoryName: null,
        slug: null,
        confidence: this.clampConfidence(raw.confidence),
        status: 'invalid_label',
        predictionId: null,
        modelVersion,
        message: 'Danh mục đề xuất không tồn tại trong hệ thống. Vui lòng chọn thủ công.',
      };
    }

    const confidence = this.clampConfidence(raw.confidence);
    const prediction = await this.prisma.aiPrediction.create({
      data: {
        userId,
        transactionId: transactionId ?? null,
        inputDescription: input.description.slice(0, 500),
        modelName,
        modelVersion,
        predictedSlug: label.slug,
        predictedCategoryId: category.id,
        confidence,
        status: 'SUGGESTED',
      },
    });

    const lowConfidence =
      typeof raw.isConfident === 'boolean'
        ? !raw.isConfident
        : confidence === null || confidence < AI_CONFIDENCE_THRESHOLD;
    return {
      categoryId: category.id,
      categoryName: category.name,
      slug: label.slug,
      confidence,
      status: lowConfidence ? 'low_confidence' : 'ok',
      predictionId: prediction.id,
      modelVersion,
      ...(lowConfidence
        ? { message: 'Độ tin cậy thấp. Vui lòng kiểm tra lại danh mục trước khi lưu.' }
        : {}),
    };
  }

  private clampConfidence(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.min(1, Math.max(0, Number(value.toFixed(4))));
  }

  private modelNotReady(): AiSuggestionDto {
    return {
      categoryId: null,
      categoryName: null,
      slug: null,
      confidence: null,
      status: 'model_not_ready',
      predictionId: null,
      modelVersion: this.configService.get<string>('AI_MODEL_VERSION') ?? 'tfidf-char-lr-v2',
      message: 'AI Service chưa sẵn sàng. Bạn vẫn có thể nhập giao dịch và chọn danh mục thủ công.',
    };
  }
}
