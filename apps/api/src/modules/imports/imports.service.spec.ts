import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { ImportsService } from './imports.service';

describe('ImportsService.purgeExpiredPreviews', () => {
  const deleteMany = jest.fn();
  const prisma = {
    importBatch: { deleteMany },
  } as unknown as PrismaService;
  const service = new ImportsService(prisma);

  beforeEach(() => {
    deleteMany.mockReset();
  });

  it('deletes only stale PREVIEW_READY batches before the cutoff', async () => {
    deleteMany.mockResolvedValue({ count: 3 });
    const now = new Date('2026-10-30T00:00:00.000Z');

    await expect(service.purgeExpiredPreviews(30, now)).resolves.toBe(3);

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        status: 'PREVIEW_READY',
        createdAt: { lt: new Date('2026-09-30T00:00:00.000Z') },
      },
    });
  });

  it('rejects a non-positive retention window without touching the database', async () => {
    await expect(service.purgeExpiredPreviews(0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.purgeExpiredPreviews(Number.NaN)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
