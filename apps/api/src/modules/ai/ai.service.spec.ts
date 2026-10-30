import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { CategoriesService } from '../categories/categories.service';
import type { AiProvider } from './ai.provider';
import { AiService } from './ai.service';

interface Mocks {
  service: AiService;
  prisma: {
    transaction: { findFirst: jest.Mock };
    category: { findFirst: jest.Mock; findMany: jest.Mock };
    aiPrediction: {
      create: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  categories: { getAccessibleOrThrow: jest.Mock };
  provider: { classify: jest.Mock; classifyBatch: jest.Mock };
}

function createService(): Mocks {
  const prisma = {
    transaction: { findFirst: jest.fn() },
    category: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'category-food',
        name: 'Ăn uống',
        slug: 'food',
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    aiPrediction: {
      create: jest.fn().mockResolvedValue({ id: 'prediction-1' }),
      update: jest.fn().mockResolvedValue({ id: 'prediction-1' }),
      findFirst: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const categories = { getAccessibleOrThrow: jest.fn() };
  const config = {
    get: jest.fn((_key: string, fallback: string) => fallback),
  } as unknown as ConfigService;
  const provider = {
    classify: jest.fn(),
    classifyBatch: jest.fn(),
    health: jest.fn(),
    modelInfo: jest.fn(),
  };

  return {
    service: new AiService(
      prisma as unknown as PrismaService,
      categories as unknown as CategoriesService,
      config,
      provider as unknown as AiProvider,
    ),
    prisma,
    categories,
    provider,
  };
}

describe('AiService', () => {
  it('returns an ok suggestion and persists the AI confidence', async () => {
    const { service, prisma, provider } = createService();
    provider.classify.mockResolvedValue({
      label: 'food',
      confidence: 0.82,
      isConfident: true,
      modelName: 'tfidf-char-logreg',
      modelVersion: 'tfidf-char-lr-v2',
    });

    const result = await service.classify('user-1', {
      description: 'cà phê sáng',
      type: 'EXPENSE',
    });

    expect(result).toMatchObject({
      categoryId: 'category-food',
      slug: 'food',
      confidence: 0.82,
      status: 'ok',
      predictionId: 'prediction-1',
    });
    expect(prisma.aiPrediction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          modelName: 'tfidf-char-logreg',
          modelVersion: 'tfidf-char-lr-v2',
          confidence: 0.82,
        }),
      }),
    );
  });

  it('trusts the AI service isConfident flag over the local threshold', async () => {
    const { service, provider } = createService();
    provider.classify.mockResolvedValue({
      label: 'food',
      confidence: 0.9,
      isConfident: false,
      modelName: 'tfidf-char-logreg',
      modelVersion: 'tfidf-char-lr-v2',
    });

    const result = await service.classify('user-1', { description: 'ăn tối', type: 'EXPENSE' });
    expect(result.status).toBe('low_confidence');
  });

  it('returns ranked, resolvable alternatives for a low-confidence answer', async () => {
    const { service, prisma, provider } = createService();
    prisma.category.findFirst.mockResolvedValue({
      id: 'category-entertainment',
      name: 'Giải trí',
      slug: 'entertainment',
    });
    prisma.category.findMany.mockResolvedValue([
      { id: 'category-entertainment', name: 'Giải trí', slug: 'entertainment' },
      { id: 'category-shopping', name: 'Mua sắm', slug: 'shopping' },
      { id: 'category-transport', name: 'Đi lại', slug: 'transport' },
    ]);
    provider.classify.mockResolvedValue({
      label: 'entertainment',
      confidence: 0.3225,
      isConfident: false,
      alternatives: [
        { label: 'entertainment', confidence: 0.3225 },
        { label: 'shopping', confidence: 0.198 },
        { label: 'salary', confidence: 0.157 }, // wrong type for EXPENSE
        { label: 'not_a_label', confidence: 0.12 }, // unknown slug
        { label: 'transport', confidence: 0.157 },
      ],
      modelName: 'tfidf-char-logreg',
      modelVersion: 'tfidf-char-lr-v2',
    });

    const result = await service.classify('user-1', { description: 'đi chơi', type: 'EXPENSE' });

    expect(result.status).toBe('low_confidence');
    expect(result.alternatives).toEqual([
      {
        categoryId: 'category-entertainment',
        categoryName: 'Giải trí',
        slug: 'entertainment',
        confidence: 0.3225,
      },
      {
        categoryId: 'category-shopping',
        categoryName: 'Mua sắm',
        slug: 'shopping',
        confidence: 0.198,
      },
      {
        categoryId: 'category-transport',
        categoryName: 'Đi lại',
        slug: 'transport',
        confidence: 0.157,
      },
    ]);
    expect(prisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          slug: { in: ['entertainment', 'shopping', 'transport'] },
          isSystem: true,
          isArchived: false,
        },
      }),
    );
  });

  it('drops alternatives that cannot be offered and omits the field when the label is invalid', async () => {
    const { service, prisma, provider } = createService();
    provider.classify.mockResolvedValue({
      label: 'food',
      confidence: 0.9,
      isConfident: true,
      alternatives: [{ label: 'transport', confidence: 0.05 }],
      modelVersion: 'v2',
    });

    const result = await service.classify('user-1', { description: 'nhận lương', type: 'INCOME' });

    expect(result.status).toBe('invalid_label');
    expect(result.alternatives).toBeUndefined();
    expect(prisma.category.findMany).not.toHaveBeenCalled();
  });

  it('rejects a label whose type does not match the transaction type', async () => {
    const { service, provider } = createService();
    provider.classify.mockResolvedValue({
      label: 'food',
      confidence: 0.9,
      isConfident: true,
      modelVersion: 'v2',
    });

    const result = await service.classify('user-1', { description: 'nhận lương', type: 'INCOME' });
    expect(result).toMatchObject({ status: 'invalid_label', categoryId: null });
  });

  it('falls back to model_not_ready when the provider fails', async () => {
    const { service, provider } = createService();
    provider.classify.mockRejectedValue(new Error('timeout'));

    const result = await service.classify('user-1', { description: 'x', type: 'EXPENSE' });
    expect(result).toMatchObject({ status: 'model_not_ready', categoryId: null });
  });

  it('requires the corrected category to belong to the user', async () => {
    const { service, prisma, categories } = createService();
    prisma.aiPrediction.findFirst.mockResolvedValue({
      id: 'prediction-1',
      predictedCategoryId: 'category-food',
    });
    categories.getAccessibleOrThrow.mockRejectedValue(new Error('not found'));

    await expect(
      service.feedback('user-1', 'prediction-1', { action: 'CORRECT', categoryId: 'other-user' }),
    ).rejects.toThrow('not found');
    expect(prisma.aiPrediction.update).not.toHaveBeenCalled();
  });

  it('accepts a prediction using its own category', async () => {
    const { service, prisma } = createService();
    prisma.aiPrediction.findFirst.mockResolvedValue({
      id: 'prediction-1',
      predictedCategoryId: 'category-food',
    });

    await service.feedback('user-1', 'prediction-1', { action: 'ACCEPT' });

    expect(prisma.aiPrediction.update).toHaveBeenCalledWith({
      where: { id: 'prediction-1' },
      data: { status: 'ACCEPTED', acceptedCategoryId: 'category-food' },
    });
  });

  it('rejects a prediction and clears any accepted category', async () => {
    const { service, prisma } = createService();
    prisma.aiPrediction.findFirst.mockResolvedValue({
      id: 'prediction-1',
      predictedCategoryId: 'category-food',
    });

    await service.feedback('user-1', 'prediction-1', { action: 'REJECT' });

    expect(prisma.aiPrediction.update).toHaveBeenCalledWith({
      where: { id: 'prediction-1' },
      data: { status: 'REJECTED', acceptedCategoryId: null },
    });
  });

  it("does not accept another user's prediction", async () => {
    const { service, prisma } = createService();
    prisma.aiPrediction.findFirst.mockResolvedValue(null);

    await expect(
      service.feedback('user-1', 'prediction-from-user-2', { action: 'ACCEPT' }),
    ).rejects.toThrow('Không tìm thấy kết quả dự đoán');
    expect(prisma.aiPrediction.update).not.toHaveBeenCalled();
  });

  it('deletes only the current user’s prediction', async () => {
    const { service, prisma } = createService();

    await service.deletePrediction('user-1', 'prediction-1');
    expect(prisma.aiPrediction.deleteMany).toHaveBeenCalledWith({
      where: { id: 'prediction-1', userId: 'user-1' },
    });

    prisma.aiPrediction.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.deletePrediction('user-1', 'prediction-2')).rejects.toThrow(
      'Không tìm thấy kết quả dự đoán',
    );
  });
});
