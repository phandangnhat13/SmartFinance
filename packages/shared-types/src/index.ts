/**
 * Types and constants shared by the web client and the API.
 * Keep this package small: only contracts that both apps genuinely need.
 */

export type AccountType = 'CASH' | 'BANK' | 'E_WALLET' | 'OTHER';
export type CategoryType = 'INCOME' | 'EXPENSE';
export type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER';
export type TransferDirection = 'OUT' | 'IN';
export type GoalStatus = 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
export type ImportStatus = 'UPLOADED' | 'PREVIEW_READY' | 'IMPORTING' | 'COMPLETED' | 'FAILED';
export type ImportRowStatus = 'VALID' | 'INVALID' | 'IMPORTED' | 'SKIPPED_DUPLICATE';
export type AiPredictionStatus = 'SUGGESTED' | 'ACCEPTED' | 'CORRECTED' | 'REJECTED';

export interface AiTaxonomyLabel {
  slug: string;
  name: string;
  type: CategoryType;
}

/**
 * Small, explicit taxonomy used by the classification model. System categories
 * in the database use the same slugs, so a predicted label can always be mapped
 * back to a legal category.
 */
export const AI_TAXONOMY: readonly AiTaxonomyLabel[] = [
  { slug: 'food', name: 'Ăn uống', type: 'EXPENSE' },
  { slug: 'transport', name: 'Đi lại', type: 'EXPENSE' },
  { slug: 'shopping', name: 'Mua sắm', type: 'EXPENSE' },
  { slug: 'housing', name: 'Nhà ở/Hóa đơn', type: 'EXPENSE' },
  { slug: 'health', name: 'Sức khỏe', type: 'EXPENSE' },
  { slug: 'entertainment', name: 'Giải trí', type: 'EXPENSE' },
  { slug: 'education', name: 'Giáo dục', type: 'EXPENSE' },
  { slug: 'transfer_fee', name: 'Chuyển khoản/Phí', type: 'EXPENSE' },
  { slug: 'other', name: 'Khác', type: 'EXPENSE' },
  { slug: 'salary', name: 'Lương/Thu nhập', type: 'INCOME' },
  { slug: 'income_other', name: 'Thu nhập khác', type: 'INCOME' },
] as const;

export const AI_CONFIDENCE_THRESHOLD = 0.55;

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  defaultCurrency: string;
  timezone: string;
  createdAt: string;
}

export interface AccountDto {
  id: string;
  name: string;
  type: AccountType;
  initialBalance: string;
  balance: string;
  currency: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryDto {
  id: string;
  name: string;
  slug: string | null;
  type: CategoryType;
  isSystem: boolean;
  isArchived: boolean;
}

export interface TransactionDto {
  id: string;
  accountId: string;
  accountName?: string;
  categoryId: string | null;
  categoryName?: string | null;
  type: TransactionType;
  amount: string;
  currency: string;
  description: string;
  note: string | null;
  occurredAt: string;
  transferGroupId: string | null;
  transferDirection: TransferDirection | null;
  createdAt: string;
}

export interface PaginatedDto<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface BudgetProgressDto {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  periodStart: string;
  periodEnd: string;
  limitAmount: string;
  spent: string;
  remaining: string;
  percentage: number;
  status: 'OK' | 'WARNING' | 'EXCEEDED';
  alerts: { threshold: number; message: string }[];
}

export interface GoalDto {
  id: string;
  name: string;
  targetAmount: string;
  savedAmount: string;
  remainingAmount: string;
  percentage: number;
  targetDate: string | null;
  status: GoalStatus;
  contributions: GoalContributionDto[];
}

export interface GoalContributionDto {
  id: string;
  amount: string;
  contributedAt: string;
  note: string | null;
}

export interface AnalyticsSummaryDto {
  from: string;
  to: string;
  income: string;
  expense: string;
  net: string;
  transactionCount: number;
}

export interface CategorySpendDto {
  categoryId: string | null;
  categoryName: string;
  total: string;
  percentage: number;
}

export interface TrendPointDto {
  period: string;
  income: string;
  expense: string;
}

export interface ComparisonDto {
  current: AnalyticsSummaryDto;
  previous: AnalyticsSummaryDto;
  incomeChangePercent: number | null;
  expenseChangePercent: number | null;
}

export interface ImportBatchDto {
  id: string;
  fileName: string;
  status: ImportStatus;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  importedRows: number;
  duplicateRows: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ImportRowDto {
  rowNumber: number;
  status: ImportRowStatus;
  rawData: Record<string, string>;
  errors: string[];
}

export interface ImportPreviewDto {
  batch: ImportBatchDto;
  rows: ImportRowDto[];
}

export interface AiSuggestionDto {
  categoryId: string | null;
  categoryName: string | null;
  slug: string | null;
  confidence: number | null;
  status: 'ok' | 'low_confidence' | 'model_not_ready' | 'invalid_label';
  predictionId: string | null;
  modelVersion: string | null;
  message?: string;
}

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CASH: 'Tiền mặt',
  BANK: 'Ngân hàng',
  E_WALLET: 'Ví điện tử',
  OTHER: 'Khác',
};

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  INCOME: 'Thu nhập',
  EXPENSE: 'Chi tiêu',
  TRANSFER: 'Chuyển tiền',
};

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  ACTIVE: 'Đang thực hiện',
  COMPLETED: 'Hoàn thành',
  ARCHIVED: 'Đã lưu trữ',
};
