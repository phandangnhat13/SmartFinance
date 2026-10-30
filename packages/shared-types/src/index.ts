/**
 * Types and constants shared by the web client and the API.
 * Keep this package small: only contracts that both apps genuinely need.
 */

export type AccountType = 'CASH' | 'BANK' | 'E_WALLET' | 'OTHER';
export type CategoryType = 'INCOME' | 'EXPENSE';
export type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER';
export type TransferDirection = 'OUT' | 'IN';
export type GoalStatus = 'ACTIVE' | 'COMPLETED' | 'ARCHIVED' | 'PAUSED';
/** Stored status plus the time-derived OVERDUE state. */
export type GoalDisplayStatus = GoalStatus | 'OVERDUE';
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

// Fallback only: the AI service returns `isConfident` using the threshold
// selected on its validation split (currently 0.50).
export const AI_CONFIDENCE_THRESHOLD = 0.5;

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  defaultCurrency: string;
  timezone: string;
  allowAiResearch: boolean;
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
  description: string | null;
  targetAmount: string;
  savedAmount: string;
  remainingAmount: string;
  percentage: number;
  currency: string;
  startDate: string;
  targetDate: string | null;
  status: GoalStatus;
  displayStatus: GoalDisplayStatus;
  isOverdue: boolean;
  /** Whole calendar months left; 0 when the target date has passed. */
  monthsRemaining: number | null;
  /**
   * Remaining amount spread over the months left. `null` when there is nothing
   * to plan against (paused, no target date, or already past the deadline).
   */
  requiredMonthlySaving: string | null;
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

/**
 * One ranked candidate from the AI service, resolved to a category the user can
 * actually pick. The client uses these when the top label is below the
 * confidence threshold, so an uncertain prediction still helps the user choose
 * instead of leaving them with a bare "choose manually" warning.
 */
export interface AiAlternativeDto {
  categoryId: string;
  categoryName: string;
  slug: string;
  confidence: number;
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
  /** Ranked candidates (highest first). Empty when the model is unavailable. */
  alternatives?: AiAlternativeDto[];
}

export type SpendingAlertType = 'LARGE_TRANSACTION' | 'CATEGORY_SPIKE' | 'POSSIBLE_DUPLICATE';
export type SpendingAlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type SpendingAlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'DISMISSED' | 'MARKED_NORMAL';

export interface SpendingAlertDto {
  id: string;
  type: SpendingAlertType;
  severity: SpendingAlertSeverity;
  status: SpendingAlertStatus;
  dedupeKey: string;
  transactionId: string | null;
  relatedTransactionId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  /** Calendar dates (YYYY-MM-DD), only for month-scoped alerts. */
  periodStart: string | null;
  periodEnd: string | null;
  /** Robust z-score, or null when the fallback ratio rule was used. Not a probability. */
  score: string | null;
  facts: Record<string, unknown>;
  /** Vietnamese, rebuilt from the stored facts so it always matches them. */
  explanation: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export type AlertScanStatus = 'completed' | 'truncated';

/**
 * What one scan did. `truncated` means a documented limit was reached, so the
 * scan must not be presented as complete: some data or candidate pairs were not
 * examined.
 */
export interface AlertScanSummaryDto {
  status: AlertScanStatus;
  detected: number;
  created: number;
  alreadyPresent: number;
  detectedByType: Record<SpendingAlertType, number>;
  scannedTransactions: number;
  window: {
    currentMonth: string;
    currentDays: number;
    referenceMonths: string[];
  };
  limits: {
    lookbackDays: number;
    candidateDays: number;
    maxTransactions: number;
    maxLargeCandidates: number;
    maxDuplicatePairs: number;
    transactionsTruncated: boolean;
    largeCandidatesCapped: boolean;
    duplicateCapReached: boolean;
  };
}

/**
 * Financial insights (M2a).
 *
 * Every figure is measured from stored INCOME/EXPENSE transactions in a single
 * currency. Internal transfers are excluded, and amounts in different
 * currencies are never added together: `currency` on each response states
 * which currency the numbers belong to.
 *
 * `monthStatus` marks a month that is still running, so the UI can say the
 * values are actual-to-date rather than a projection. `estimated` is always
 * false until a later milestone introduces forecasts.
 */
export type InsightMonthStatus = 'in_progress' | 'complete';

export interface InsightsOverviewDto {
  currency: string;
  timezone: string;
  /** Calendar month in the user's timezone, YYYY-MM. */
  month: string;
  monthStatus: InsightMonthStatus;
  /** Calendar dates (YYYY-MM-DD) of the local month. */
  periodStart: string;
  periodEnd: string;
  income: string;
  expense: string;
  net: string;
  /** net / income × 100, or null when the month has no income. */
  savingsRate: number | null;
  transactionCount: number;
  estimated: false;
  previous: {
    month: string;
    income: string;
    expense: string;
    net: string;
    savingsRate: number | null;
    incomeChangePercent: number | null;
    expenseChangePercent: number | null;
  };
  /** Currencies with at least one transaction for this user (default first). */
  availableCurrencies: string[];
}

export interface InsightMonthPointDto {
  month: string;
  monthStatus: InsightMonthStatus;
  income: string;
  expense: string;
  net: string;
  savingsRate: number | null;
  transactionCount: number;
  hasTransactions: boolean;
}

export interface InsightsMonthlyDto {
  currency: string;
  timezone: string;
  estimated: false;
  months: InsightMonthPointDto[];
}

export interface InsightCategoryItemDto {
  categoryId: string | null;
  categoryName: string;
  total: string;
  sharePercent: number;
  transactionCount: number;
  previousTotal: string;
  changeAmount: string;
  /** null when the category had no spending in the previous month. */
  changePercent: number | null;
  /** previousTotal > 0 and the increase reaches the documented threshold. */
  notableIncrease: boolean;
  /** Spending in a category that had no spending the month before. */
  isNewSpending: boolean;
}

export interface InsightsCategoriesDto {
  currency: string;
  timezone: string;
  month: string;
  previousMonth: string;
  monthStatus: InsightMonthStatus;
  total: string;
  previousTotal: string;
  changePercent: number | null;
  estimated: false;
  thresholds: { notableIncreasePercent: number };
  items: InsightCategoryItemDto[];
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
  PAUSED: 'Tạm dừng',
};

export const GOAL_DISPLAY_STATUS_LABELS: Record<GoalDisplayStatus, string> = {
  ACTIVE: 'Đang thực hiện',
  COMPLETED: 'Hoàn thành',
  ARCHIVED: 'Đã lưu trữ',
  PAUSED: 'Tạm dừng',
  OVERDUE: 'Quá hạn',
};
