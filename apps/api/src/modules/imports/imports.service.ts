import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Account, Category, ImportBatch, Prisma } from '@prisma/client';
import { parse as parseCsv } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { DateTime } from 'luxon';
import { PrismaService } from '../../common/prisma/prisma.service';
import { importFingerprint, normalizeText } from '../../common/utils/hash';
import { isPositiveMoney, moneyString, toDecimal } from '../../common/utils/money';
import { DATE_ONLY_REGEX, resolveDateRange } from '../../common/utils/period';
import { ExportTransactionsQuery } from './dto/export.query';
import { safeCsvCell } from './csv.util';

const MAX_ROWS = 5000;
const MAX_UPLOAD_BYTES = 2_000_000;
const EXPORT_LIMIT = 50_000;
const REQUIRED_HEADERS = ['account', 'type', 'amount', 'occurredat', 'description'];

interface ParsedRow {
  accountId: string;
  accountName: string;
  type: 'INCOME' | 'EXPENSE';
  amount: string;
  currency: string;
  occurredAt: string;
  description: string;
  categoryId: string;
  note: string | null;
  importHash: string;
}

interface RowDraft {
  rowNumber: number;
  rawData: Record<string, string>;
  parsedData: ParsedRow | null;
  status: 'VALID' | 'INVALID' | 'SKIPPED_DUPLICATE';
  errors: string[];
}

@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(userId: string, file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('Vui lòng chọn tệp CSV');
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      throw new BadRequestException('Chỉ hỗ trợ tệp .csv');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException('Tệp CSV vượt quá giới hạn 2MB');
    }

    const rows = this.parseRows(file.buffer);
    if (rows.length === 0) {
      throw new BadRequestException('Tệp CSV không có dòng dữ liệu');
    }
    if (rows.length > MAX_ROWS) {
      throw new BadRequestException(`Tệp CSV vượt quá ${MAX_ROWS} dòng dữ liệu`);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const timezone = user?.timezone ?? 'Asia/Ho_Chi_Minh';

    const [accounts, categories] = await Promise.all([
      this.prisma.account.findMany({ where: { userId, isArchived: false } }),
      this.prisma.category.findMany({
        where: {
          isArchived: false,
          OR: [{ isSystem: true }, { userId }],
        },
      }),
    ]);

    const accountIndex = this.indexAccounts(accounts);
    const categoryIndex = this.indexCategories(categories);
    const defaultCategories = {
      EXPENSE: categories.find((category) => category.slug === 'other') ?? null,
      INCOME: categories.find((category) => category.slug === 'income_other') ?? null,
    };

    const drafts = rows.map((raw, index) =>
      this.validateRow(raw, index + 2, {
        userId,
        timezone,
        accountIndex,
        categoryIndex,
        defaultCategories,
      }),
    );

    const hashes = drafts
      .map((draft) => draft.parsedData?.importHash)
      .filter((hash): hash is string => Boolean(hash));
    const existing = hashes.length
      ? await this.prisma.transaction.findMany({
          where: { userId, importHash: { in: hashes } },
          select: { importHash: true },
        })
      : [];
    const existingHashes = new Set(existing.map((row) => row.importHash));
    const seen = new Set<string>();
    for (const draft of drafts) {
      const hash = draft.parsedData?.importHash;
      if (!hash || draft.status !== 'VALID') continue;
      if (existingHashes.has(hash) || seen.has(hash)) {
        draft.status = 'SKIPPED_DUPLICATE';
        draft.errors.push('Trùng với giao dịch đã có hoặc trùng trong cùng tệp');
      }
      seen.add(hash);
    }

    const counts = this.countRows(drafts);
    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.importBatch.create({
        data: {
          userId,
          fileName: file.originalname,
          status: 'PREVIEW_READY',
          totalRows: counts.total,
          validRows: counts.valid,
          invalidRows: counts.invalid,
          duplicateRows: counts.duplicate,
        },
      });
      await tx.importRow.createMany({
        data: drafts.map((draft) => ({
          batchId: created.id,
          rowNumber: draft.rowNumber,
          rawData: draft.rawData,
          parsedData: draft.parsedData
            ? (draft.parsedData as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          status: draft.status,
          errors: draft.errors,
        })),
      });
      return created;
    });

    return {
      batch: this.toBatchDto(batch),
      rows: drafts.map((draft) => ({
        rowNumber: draft.rowNumber,
        status: draft.status,
        rawData: draft.rawData,
        errors: draft.errors,
      })),
    };
  }

  async list(userId: string) {
    const batches = await this.prisma.importBatch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return batches.map((batch) => this.toBatchDto(batch));
  }

  async getPreview(userId: string, id: string) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id, userId },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
    if (!batch) throw new NotFoundException('Không tìm thấy phiên import');
    return {
      batch: this.toBatchDto(batch),
      rows: batch.rows.map((row) => ({
        rowNumber: row.rowNumber,
        status: row.status,
        rawData: row.rawData as Record<string, string>,
        errors: row.errors as string[],
      })),
    };
  }

  async commit(userId: string, id: string) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id, userId },
      include: { rows: { where: { status: 'VALID' }, orderBy: { rowNumber: 'asc' } } },
    });
    if (!batch) throw new NotFoundException('Không tìm thấy phiên import');
    if (batch.status !== 'PREVIEW_READY') {
      throw new ConflictException('Phiên import đã được xử lý');
    }
    if (batch.rows.length === 0) {
      throw new BadRequestException('Không có dòng hợp lệ để nhập');
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const data = batch.rows
          .map((row) => row.parsedData as unknown as ParsedRow | null)
          .filter((parsed): parsed is ParsedRow => Boolean(parsed))
          .map((parsed) => ({
            userId,
            accountId: parsed.accountId,
            categoryId: parsed.categoryId,
            type: parsed.type,
            amount: toDecimal(parsed.amount),
            currency: parsed.currency,
            description: parsed.description,
            note: parsed.note,
            occurredAt: new Date(parsed.occurredAt),
            importBatchId: batch.id,
            importHash: parsed.importHash,
          }));

        const created = await tx.transaction.createMany({
          data,
          skipDuplicates: true,
        });
        await tx.importRow.updateMany({
          where: { batchId: batch.id, status: 'VALID' },
          data: { status: 'IMPORTED' },
        });
        return tx.importBatch.update({
          where: { id: batch.id },
          data: {
            status: 'COMPLETED',
            importedRows: created.count,
            duplicateRows: batch.duplicateRows + (batch.rows.length - created.count),
            completedAt: new Date(),
          },
        });
      });
      return this.toBatchDto(result);
    } catch (error) {
      await this.prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'Import thất bại',
        },
      });
      throw error;
    }
  }

  async exportCsv(
    userId: string,
    query: ExportTransactionsQuery,
  ): Promise<{ csv: string; fileName: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const where: Prisma.TransactionWhereInput = { userId };

    if (query.from || query.to) {
      if (!query.from || !query.to) {
        throw new BadRequestException('Cần cung cấp cả from và to');
      }
      try {
        const range = resolveDateRange(query.from, query.to, user?.timezone ?? 'Asia/Ho_Chi_Minh');
        where.occurredAt = { gte: range.start, lt: range.endExclusive };
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : 'Khoảng thời gian không hợp lệ',
        );
      }
    }
    if (query.type) where.type = query.type;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.accountId) where.accountId = query.accountId;
    if (query.q?.trim()) {
      where.description = { contains: query.q.trim(), mode: 'insensitive' };
    }

    const transactions = await this.prisma.transaction.findMany({
      where,
      include: {
        account: { select: { name: true } },
        category: { select: { name: true } },
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: EXPORT_LIMIT,
    });

    const rows: string[][] = [
      [
        'occurredAt',
        'type',
        'amount',
        'currency',
        'account',
        'category',
        'description',
        'note',
        'transferDirection',
        'transferGroupId',
      ],
    ];
    for (const transaction of transactions) {
      rows.push([
        transaction.occurredAt.toISOString(),
        transaction.type,
        moneyString(transaction.amount),
        transaction.currency,
        safeCsvCell(transaction.account?.name),
        safeCsvCell(transaction.category?.name ?? ''),
        safeCsvCell(transaction.description),
        safeCsvCell(transaction.note ?? ''),
        transaction.transferDirection ?? '',
        transaction.transferGroupId ?? '',
      ]);
    }

    const csv = stringify(rows);
    const stamp = DateTime.utc().toFormat('yyyyLLdd-HHmmss');
    return { csv: `\uFEFF${csv}`, fileName: `transactions-${stamp}.csv` };
  }

  private parseRows(buffer: Buffer): Record<string, string>[] {
    let matrix: string[][];
    try {
      matrix = parseCsv(buffer, {
        bom: true,
        skip_empty_lines: true,
        relax_quotes: true,
        trim: true,
      }) as string[][];
    } catch (error) {
      throw new BadRequestException(
        `Không đọc được CSV: ${error instanceof Error ? error.message : 'định dạng không hợp lệ'}`,
      );
    }
    if (matrix.length === 0) return [];
    const header = (matrix[0] ?? []).map((cell) => cell.trim().toLowerCase());
    const missing = REQUIRED_HEADERS.filter((required) => !header.includes(required));
    if (missing.length > 0) {
      throw new BadRequestException(`Thiếu cột bắt buộc: ${missing.join(', ')}. Xem template CSV.`);
    }
    return matrix.slice(1).map((cells) => {
      const record: Record<string, string> = {};
      header.forEach((key, index) => {
        if (key) record[key] = (cells[index] ?? '').trim();
      });
      return record;
    });
  }

  private indexAccounts(accounts: Account[]): Map<string, Account[]> {
    const map = new Map<string, Account[]>();
    for (const account of accounts) {
      const key = normalizeText(account.name);
      map.set(key, [...(map.get(key) ?? []), account]);
    }
    return map;
  }

  private indexCategories(categories: Category[]): Map<string, Category[]> {
    const map = new Map<string, Category[]>();
    for (const category of categories) {
      const key = `${category.type}|${normalizeText(category.name)}`;
      map.set(key, [...(map.get(key) ?? []), category]);
    }
    return map;
  }

  private validateRow(
    raw: Record<string, string>,
    rowNumber: number,
    context: {
      userId: string;
      timezone: string;
      accountIndex: Map<string, Account[]>;
      categoryIndex: Map<string, Category[]>;
      defaultCategories: { INCOME: Category | null; EXPENSE: Category | null };
    },
  ): RowDraft {
    const errors: string[] = [];
    const accountNameRaw = raw.account ?? '';
    const typeRaw = (raw.type ?? '').toUpperCase();
    const amountRaw = raw.amount ?? '';
    const occurredAtRaw = raw.occurredAt ?? raw.occurredat ?? '';
    const description = (raw.description ?? '').trim();
    const categoryRaw = (raw.category ?? '').trim();
    const note = (raw.note ?? '').trim();
    const currencyRaw = (raw.currency ?? '').trim().toUpperCase();

    if (!description) errors.push('Thiếu mô tả (description)');
    if (description.length > 500) errors.push('Mô tả vượt quá 500 ký tự');
    if (note.length > 1000) errors.push('Ghi chú vượt quá 1000 ký tự');

    const accounts = context.accountIndex.get(normalizeText(accountNameRaw)) ?? [];
    if (!accountNameRaw) errors.push('Thiếu tên tài khoản (account)');
    else if (accounts.length === 0) {
      errors.push(`Không tìm thấy tài khoản "${accountNameRaw}"`);
    } else if (accounts.length > 1) {
      errors.push(`Tên tài khoản "${accountNameRaw}" không duy nhất`);
    }
    const account = accounts[0];

    if (typeRaw === 'TRANSFER') {
      errors.push('Chưa hỗ trợ import giao dịch TRANSFER. Hãy tạo chuyển tiền trong ứng dụng.');
    } else if (typeRaw !== 'INCOME' && typeRaw !== 'EXPENSE') {
      errors.push('Loại giao dịch phải là INCOME hoặc EXPENSE');
    }

    const normalizedAmount = amountRaw.replace(/[,\s]/g, '');
    if (!normalizedAmount) errors.push('Thiếu số tiền (amount)');
    else if (!isPositiveMoney(normalizedAmount)) {
      errors.push('Số tiền phải lớn hơn 0, tối đa 2 chữ số thập phân');
    }

    const occurredAt = this.parseDate(occurredAtRaw, context.timezone);
    if (!occurredAtRaw) errors.push('Thiếu thời điểm giao dịch (occurredAt)');
    else if (!occurredAt) errors.push('Thời điểm giao dịch không hợp lệ (YYYY-MM-DD hoặc ISO)');

    let category: Category | undefined;
    if (categoryRaw && (typeRaw === 'INCOME' || typeRaw === 'EXPENSE')) {
      const matches = context.categoryIndex.get(`${typeRaw}|${normalizeText(categoryRaw)}`) ?? [];
      if (matches.length === 0) {
        errors.push(`Không tìm thấy danh mục "${categoryRaw}" phù hợp với loại ${typeRaw}`);
      } else if (matches.length > 1) {
        errors.push(`Danh mục "${categoryRaw}" không duy nhất`);
      }
      category = matches[0];
    } else if (typeRaw === 'INCOME' || typeRaw === 'EXPENSE') {
      category = context.defaultCategories[typeRaw] ?? undefined;
      if (!category) {
        errors.push('Không tìm thấy danh mục mặc định cho loại giao dịch');
      }
    }

    if (account && currencyRaw && currencyRaw !== account.currency) {
      errors.push(`Tiền tệ phải khớp với tài khoản (${account.currency})`);
    }

    if (errors.length > 0 || !account || !occurredAt || !category) {
      return { rowNumber, rawData: raw, parsedData: null, status: 'INVALID', errors };
    }
    if (typeRaw !== 'INCOME' && typeRaw !== 'EXPENSE') {
      return {
        rowNumber,
        rawData: raw,
        parsedData: null,
        status: 'INVALID',
        errors: ['Loại giao dịch phải là INCOME hoặc EXPENSE'],
      };
    }

    const amount = toDecimal(normalizedAmount).toFixed(2);
    const parsed: ParsedRow = {
      accountId: account.id,
      accountName: account.name,
      type: typeRaw,
      amount,
      currency: account.currency,
      occurredAt: occurredAt.toISOString(),
      description,
      categoryId: category.id,
      note: note || null,
      importHash: importFingerprint({
        userId: context.userId,
        accountId: account.id,
        type: typeRaw,
        amount,
        occurredAtIso: occurredAt.toISOString(),
        description,
      }),
    };

    return { rowNumber, rawData: raw, parsedData: parsed, status: 'VALID', errors: [] };
  }

  private parseDate(value: string, timezone: string): Date | null {
    if (!value) return null;
    let parsed: DateTime;
    if (DATE_ONLY_REGEX.test(value)) {
      parsed = DateTime.fromISO(value, { zone: timezone }).startOf('day');
    } else {
      parsed = DateTime.fromISO(value, { setZone: true });
      if (!parsed.isValid) return null;
    }
    if (!parsed.isValid) return null;
    const year = parsed.toUTC().year;
    if (year < 1970 || year > 2100) return null;
    return parsed.toUTC().toJSDate();
  }

  private countRows(drafts: RowDraft[]) {
    return {
      total: drafts.length,
      valid: drafts.filter((draft) => draft.status === 'VALID').length,
      invalid: drafts.filter((draft) => draft.status === 'INVALID').length,
      duplicate: drafts.filter((draft) => draft.status === 'SKIPPED_DUPLICATE').length,
    };
  }

  private toBatchDto(batch: ImportBatch) {
    return {
      id: batch.id,
      fileName: batch.fileName,
      status: batch.status,
      totalRows: batch.totalRows,
      validRows: batch.validRows,
      invalidRows: batch.invalidRows,
      importedRows: batch.importedRows,
      duplicateRows: batch.duplicateRows,
      errorMessage: batch.errorMessage,
      createdAt: batch.createdAt.toISOString(),
      completedAt: batch.completedAt ? batch.completedAt.toISOString() : null,
    };
  }
}
