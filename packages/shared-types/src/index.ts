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

/**
 * Income & expense trends (M3a).
 *
 * Historical analytics only: every figure is read from stored INCOME/EXPENSE
 * transactions in one currency, inside `[periodStart, periodEndExclusive)` in
 * the user's timezone. Internal transfers never count, currencies are never
 * added together, and a month with no transactions is reported as
 * `hasTransactions: false` instead of being silently interpolated.
 */
export type AnalyticsPeriodKind = 'month' | 'quarter' | 'year' | 'custom';
export type AnalyticsPeriodStatus = 'in_progress' | 'complete';

export interface AnalyticsPeriodDescriptorDto {
  kind: AnalyticsPeriodKind;
  /** Human-readable period, e.g. 2026-10, 2026-Q4, 2026, or a date range. */
  label: string;
  /** First calendar day of the period in the user's timezone (YYYY-MM-DD). */
  from: string;
  /** Last calendar day of the period in the user's timezone (YYYY-MM-DD). */
  to: string;
  /** `in_progress` when the period has not ended yet. */
  status: AnalyticsPeriodStatus;
}

export interface AnalyticsChangeDto {
  /** current − previous, as a money string (may be negative). */
  amount: string;
  /** null when the previous value was zero (no baseline to compare against). */
  percent: number | null;
}

export interface AnalyticsOverviewDto {
  currency: string;
  timezone: string;
  period: AnalyticsPeriodDescriptorDto;
  income: string;
  expense: string;
  net: string;
  /** net / income × 100, or null when the period has no income. */
  savingsRate: number | null;
  transactionCount: number;
  hasTransactions: boolean;
  estimated: false;
  previous: {
    period: AnalyticsPeriodDescriptorDto;
    income: string;
    expense: string;
    net: string;
    savingsRate: number | null;
    transactionCount: number;
    hasTransactions: boolean;
  };
  changes: {
    income: AnalyticsChangeDto;
    expense: AnalyticsChangeDto;
    net: AnalyticsChangeDto;
    /** Percentage-point change of the savings rate; null if either side is null. */
    savingsRatePoints: number | null;
  };
  /** Currencies with at least one transaction for this user (default first). */
  availableCurrencies: string[];
}

export interface AnalyticsTrendPointDto {
  month: string;
  monthStatus: InsightMonthStatus;
  income: string;
  expense: string;
  net: string;
  savingsRate: number | null;
  transactionCount: number;
  /** false means "no data" for this month, not a measured zero. */
  hasTransactions: boolean;
}

export interface AnalyticsTrendsDto {
  currency: string;
  timezone: string;
  rangeMonths: number;
  estimated: false;
  points: AnalyticsTrendPointDto[];
}

export interface AnalyticsAmountPointDto {
  month: string;
  monthStatus: InsightMonthStatus;
  amount: string;
  hasTransactions: boolean;
  /** Change against the previous month; null with no baseline or no previous data. */
  changePercent: number | null;
}

export interface AnalyticsExtremeMonthDto {
  month: string;
  amount: string;
}

export interface AnalyticsIncomeSourceDto {
  categoryId: string | null;
  categoryName: string;
  total: string;
  sharePercent: number;
  transactionCount: number;
}

export interface AnalyticsIncomeDto {
  currency: string;
  timezone: string;
  rangeMonths: number;
  estimated: false;
  points: AnalyticsAmountPointDto[];
  total: string;
  /** Total ÷ months that actually had income; null when there was none. */
  averageMonthly: string | null;
  monthsWithIncome: number;
  highest: AnalyticsExtremeMonthDto | null;
  lowest: AnalyticsExtremeMonthDto | null;
  sources: AnalyticsIncomeSourceDto[];
}

export interface AnalyticsExpenseDto {
  currency: string;
  timezone: string;
  rangeMonths: number;
  estimated: false;
  points: AnalyticsAmountPointDto[];
  total: string;
  /** Total ÷ months that actually had expense; null when there was none. */
  averageMonthly: string | null;
  monthsWithExpense: number;
  highest: AnalyticsExtremeMonthDto | null;
  lowest: AnalyticsExtremeMonthDto | null;
  /** Population coefficient of variation (stdev ÷ mean × 100); null with <2 months. */
  volatilityPercent: number | null;
  /** Longest run of consecutive month-over-month increases in the window. */
  longestIncreasingStreak: number;
  /** The increasing run that is still active at the last month with data. */
  currentIncreasingStreak: number;
}

export type AnalyticsCategoryChangeDirection = 'increase' | 'decrease' | 'new' | 'removed';

export interface AnalyticsCategoryChangeDto {
  categoryId: string | null;
  categoryName: string;
  currentTotal: string;
  previousTotal: string;
  changeAmount: string;
  changePercent: number | null;
  direction: AnalyticsCategoryChangeDirection;
}

export interface AnalyticsComparisonSideDto {
  period: AnalyticsPeriodDescriptorDto;
  income: string;
  expense: string;
  net: string;
  savingsRate: number | null;
  transactionCount: number;
  hasTransactions: boolean;
}

export interface AnalyticsPeriodComparisonDto {
  currency: string;
  timezone: string;
  estimated: false;
  current: AnalyticsComparisonSideDto;
  previous: AnalyticsComparisonSideDto;
  changes: {
    income: AnalyticsChangeDto;
    expense: AnalyticsChangeDto;
    net: AnalyticsChangeDto;
    savingsRatePoints: number | null;
  };
  notableCategoryChanges: AnalyticsCategoryChangeDto[];
}

/**
 * Category analytics (M3b). Categories are grouped by their database id, never
 * by display name, so two categories that happen to share a name stay separate.
 * The uncategorised bucket has `categoryId: null`.
 *
 * `monthsInPeriod` is the number of calendar months the selected period covers
 * up to today (a full month counts as 1). `averageMonthly` divides the total by
 * that count; it is not an average over only the months with activity.
 */
export type AnalyticsCategoryView = 'INCOME' | 'EXPENSE';

export interface AnalyticsCategoryRowDto {
  categoryId: string | null;
  categoryName: string;
  /** Archived categories still appear if they have historical transactions. */
  isArchived: boolean;
  total: string;
  transactionCount: number;
  /** Category total ÷ the period's income (or expense) total × 100. */
  sharePercent: number;
  averageMonthly: string | null;
  previousTotal: string;
  changeAmount: string;
  changePercent: number | null;
  direction: AnalyticsCategoryChangeDirection;
  /** Increase of at least `notableIncreasePercent` against the previous period. */
  notableIncrease: boolean;
  isNew: boolean;
  isRemoved: boolean;
  /** 1-based rank by current total; null for categories with no current activity. */
  rank: number | null;
}

export interface AnalyticsCategoryTrendPointDto {
  month: string;
  monthStatus: InsightMonthStatus;
  amount: string;
  /** false means the category had no transaction in this month, not a zero. */
  hasTransactions: boolean;
  changePercent: number | null;
}

export interface AnalyticsCategoryTrendDto {
  categoryId: string;
  categoryName: string;
  rangeMonths: number;
  points: AnalyticsCategoryTrendPointDto[];
}

export interface AnalyticsCategoriesDto {
  currency: string;
  timezone: string;
  type: AnalyticsCategoryView;
  estimated: false;
  period: AnalyticsPeriodDescriptorDto;
  previousPeriod: AnalyticsPeriodDescriptorDto;
  total: string;
  previousTotal: string;
  hasTransactions: boolean;
  monthsInPeriod: number;
  /** Product rule reused from insights: an increase of at least 25% is notable. */
  notableIncreasePercent: number;
  categories: AnalyticsCategoryRowDto[];
  /** Per-month series for the requested category, or null when none was asked for. */
  trend: AnalyticsCategoryTrendDto | null;
}

/**
 * Budget analytics (M3b). The Budget model stores no currency: the limit is
 * interpreted in the `currency` requested (the user's default currency by
 * default), and only same-currency spending counts towards it.
 */
export type BudgetAnalyticsStatus =
  'NOT_STARTED' | 'ON_TRACK' | 'WARNING' | 'EXCEEDED' | 'COMPLETED';

/**
 * Why an exhaustion date is (not) produced. The API never invents a date when
 * there is too little data; it reports the reason instead.
 */
export type BudgetExhaustionProjection =
  | 'not_started'
  | 'period_ended'
  | 'no_spending'
  | 'already_exceeded'
  | 'within_period'
  | 'beyond_period';

export interface BudgetAnalyticsItemDto {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  limitAmount: string;
  spent: string;
  remaining: string;
  /** spent ÷ limit × 100; null when the limit is not positive. */
  usagePercent: number | null;
  status: BudgetAnalyticsStatus;
  /** Lowest configured warning threshold below 100, or null when none. */
  warningThreshold: number | null;
  /** Budget period, date-only in the user's timezone. */
  periodStart: string;
  periodEnd: string;
  totalDays: number;
  daysElapsed: number;
  daysRemaining: number;
  /** spent ÷ daysElapsed; null before the period starts. */
  dailySpendingAverage: string | null;
  /** limit × daysElapsed ÷ totalDays; linear allowance to date. */
  expectedSpend: string | null;
  /** spent − expectedSpend; positive means ahead of the linear pace. */
  variance: string | null;
  /** spent ÷ expectedSpend × 100; null when there is no allowance to date. */
  pacePercent: number | null;
  /** YYYY-MM-DD when spending at the current daily average would use up the limit. */
  estimatedExhaustionDate: string | null;
  exhaustionProjection: BudgetExhaustionProjection;
  transactionCount: number;
}

export interface AnalyticsBudgetsDto {
  currency: string;
  timezone: string;
  month: string;
  estimated: false;
  /** Today's date in the user's timezone, used for elapsed-day calculations. */
  asOf: string;
  monthStatus: AnalyticsPeriodStatus;
  /** The budget limit has no currency column; it is read in this currency. */
  assumesLimitCurrency: string;
  summary: {
    budgetCount: number;
    exceededCount: number;
    warningCount: number;
    onTrackCount: number;
    notStartedCount: number;
    completedCount: number;
  };
  items: BudgetAnalyticsItemDto[];
}

export interface BudgetPaceItemDto {
  budgetId: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  status: BudgetAnalyticsStatus;
  limitAmount: string;
  spent: string;
  expectedSpend: string | null;
  variance: string | null;
  pacePercent: number | null;
  dailySpendingAverage: string | null;
  daysElapsed: number;
  daysRemaining: number;
  estimatedExhaustionDate: string | null;
  exhaustionProjection: BudgetExhaustionProjection;
}

export interface AnalyticsBudgetPaceDto {
  currency: string;
  timezone: string;
  month: string;
  estimated: false;
  asOf: string;
  items: BudgetPaceItemDto[];
}

/**
 * Financial forecasting (M3c).
 *
 * Forecasts are statistical estimates computed on the server from the user's own
 * completed months. They are never called AI and are never presented as actual
 * data: every figure carries the model, the backtest error and the data quality
 * that produced it. When there is not enough history the API withholds numbers
 * instead of guessing.
 */
export type ForecastHorizon = 'current_month' | '1m' | '3m' | '6m';

export type ForecastModel = 'historical_average' | 'weighted_moving_average' | 'linear_trend';

export type ForecastStatus = 'ok' | 'insufficient_data';

export type ForecastReason =
  'no_complete_months' | 'too_few_months' | 'no_income' | 'no_accounts' | 'missing_series' | null;

export type ForecastConfidenceLevel = 'high' | 'medium' | 'low';

export type ForecastDataQuality = 'good' | 'limited' | 'insufficient';

export interface ForecastBacktestDto {
  model: ForecastModel;
  /** False when the model needs more history than the user has. */
  eligible: boolean;
  reason: string | null;
  /** Rolling origins this model was actually tested on. */
  origins: number;
  /** Mean absolute error across those origins, in the requested currency. */
  mae: string | null;
  /** MAE ÷ mean actual × 100 for the tested months. */
  wapePercent: number | null;
}

export interface ForecastConfidenceDto {
  level: ForecastConfidenceLevel;
  /** 0–100 product score; the basis below explains every component. */
  score: number;
  basis: string[];
}

export interface ForecastDataQualityDto {
  /** Complete calendar months in the analysis window. */
  completeMonthsConsidered: number;
  /** Of those, months that actually had a transaction. */
  monthsWithData: number;
  /** Calendar months inside the window with no transaction at all. */
  missingMonths: string[];
  transactionCount: number;
  /** monthsWithData ÷ completeMonthsConsidered × 100. */
  continuityPercent: number;
  level: ForecastDataQuality;
}

export interface ForecastHistoryPointDto {
  month: string;
  /** Actual recorded amount for that completed month. */
  amount: string;
  hasTransactions: boolean;
}

export interface ForecastMonthValueDto {
  month: string;
  amount: string;
  /** True for the current month, whose figure is the remaining amount only. */
  isPartial: boolean;
}

export interface ForecastSeriesDto {
  kind: 'income' | 'expense';
  status: ForecastStatus;
  reason: ForecastReason;
  model: ForecastModel | null;
  /** Backtest result per candidate model, strongest context for the choice. */
  modelScores: ForecastBacktestDto[];
  /** Human-readable reason the selected model won (or the fallback used). */
  selectedBecause: string | null;
  confidence: ForecastConfidenceDto;
  /** Average of the completed months with data; context, not a forecast. */
  monthlyAverage: string | null;
  monthsWithData: number;
  /** Actual per-month amounts for the chart, oldest first. */
  history: ForecastHistoryPointDto[];
  /** One entry per month in the requested horizon. */
  months: ForecastMonthValueDto[];
  /** Sum of `months`; for the current-month horizon this is the remainder. */
  horizonTotal: string | null;
}

/**
 * Expense forecast for one category. Only categories with enough complete
 * months are returned; the rest are omitted rather than guessed.
 */
export interface ForecastCategoryDto {
  categoryId: string | null;
  categoryName: string;
  status: ForecastStatus;
  reason: ForecastReason;
  model: ForecastModel | null;
  confidence: ForecastConfidenceLevel;
  monthsWithData: number;
  monthlyAverage: string | null;
  months: ForecastMonthValueDto[];
  horizonTotal: string | null;
}

export interface ForecastCashFlowDto {
  status: ForecastStatus;
  reason: ForecastReason;
  model: ForecastModel | null;
  /** Forecast income − forecast expense for the same horizon. */
  base: string | null;
  /**
   * Simple error band: base ± the selected models' backtest MAE. It is not a
   * statistical confidence interval and is null when no backtest exists.
   */
  best: string | null;
  worst: string | null;
  bandMethod: 'mae' | null;
}

export interface ForecastBalanceDto {
  status: ForecastStatus;
  reason: ForecastReason;
  /** Sum of initial balances plus every recorded transaction up to now. */
  currentBalance: string | null;
  /** Forecast income still expected between now and the end of this month. */
  remainingIncome: string | null;
  /** Forecast expense still expected between now and the end of this month. */
  remainingExpense: string | null;
  /** currentBalance + remainingIncome − remainingExpense. */
  projectedBalance: string | null;
  accountsIncluded: number;
  accountsArchived: number;
  /** Transfers move money between same-currency accounts, so they net to zero. */
  transfersNetted: true;
}

/** Context every forecast response carries, whatever slice it returns. */
export interface ForecastContextDto {
  currency: string;
  timezone: string;
  asOf: string;
  generatedAt: string;
  horizon: ForecastHorizon;
  /** Forecast months; for `current_month` it is the current month only. */
  horizonMonths: string[];
  dataQuality: ForecastDataQualityDto;
  /** Method statements the UI must show next to the numbers. */
  assumptions: string[];
  limitations: string[];
  /** False: nothing here is AI, ML or an LLM estimate. */
  estimated: true;
}

export interface AnalyticsForecastDto extends ForecastContextDto {
  status: ForecastStatus;
  reason: ForecastReason;
  income: ForecastSeriesDto;
  expense: ForecastSeriesDto;
  /** Per-category expense forecasts, only for categories with enough history. */
  categoryForecasts: ForecastCategoryDto[];
  net: ForecastCashFlowDto;
  monthEndBalance: ForecastBalanceDto;
}

export interface AnalyticsForecastIncomeDto extends ForecastContextDto {
  slice: 'income';
  status: ForecastStatus;
  reason: ForecastReason;
  income: ForecastSeriesDto;
}

export interface AnalyticsForecastExpensesDto extends ForecastContextDto {
  slice: 'expenses';
  status: ForecastStatus;
  reason: ForecastReason;
  expense: ForecastSeriesDto;
  categoryForecasts: ForecastCategoryDto[];
}

export interface AnalyticsForecastCashFlowDto extends ForecastContextDto {
  slice: 'cash-flow';
  status: ForecastStatus;
  reason: ForecastReason;
  net: ForecastCashFlowDto;
  monthEndBalance: ForecastBalanceDto;
}

/** One endpoint family: `/analytics/forecast` and its three slices. */
export type AnalyticsForecastSlice = 'all' | 'income' | 'expenses' | 'cash-flow';

/**
 * Financial health score (M3d).
 *
 * A deterministic, rule-based score over five groups. It is not a credit score,
 * not a creditworthiness decision and not AI output; missing data never counts
 * as zero and no figure is written back to the database.
 */
export type HealthClassification =
  'EXCELLENT' | 'GOOD' | 'FAIR' | 'NEEDS_ATTENTION' | 'INSUFFICIENT_DATA';

/** Which data the group reads. Every group maps to an existing module. */
export type HealthGroupKey = 'cash-flow' | 'budget' | 'savings' | 'stability' | 'forecast-risk';

export type HealthGroupStatus = 'scored' | 'insufficient_data';

export type HealthDataQuality = 'good' | 'limited' | 'insufficient';

export type HealthRecommendationSeverity = 'high' | 'medium' | 'low';

export type HealthRecommendationModule =
  'transactions' | 'budgets' | 'savings' | 'accounts' | 'analytics-forecast';

export interface HealthEvidenceDto {
  /** Stable machine key, e.g. `savings_rate`. */
  key: string;
  label: string;
  /** Display value, already formatted with its unit. */
  value: string;
  /** Threshold or comparison the value is measured against, when one applies. */
  reference: string | null;
}

export interface HealthGroupDto {
  key: HealthGroupKey;
  label: string;
  /** Configured weight in percent; the five weights sum to 100. */
  weight: number;
  status: HealthGroupStatus;
  /** 0–100. Null when the group cannot be scored; missing data is never zero. */
  score: number | null;
  classification: HealthClassification;
  /** score × weight ÷ 100, null when the group is not scored. */
  contribution: number | null;
  explanation: string;
  evidence: HealthEvidenceDto[];
  /** What is missing, in words. Empty when the group was fully scored. */
  missingData: string[];
  limitations: string[];
}

export interface HealthRecommendationDto {
  id: string;
  group: HealthGroupKey;
  severity: HealthRecommendationSeverity;
  title: string;
  detail: string;
  evidence: string[];
  /** The concrete amount or change the advice refers to, in words. */
  impact: string;
  confidence: 'high' | 'medium' | 'low';
  limitations: string[];
  /** The module that owns the data; the UI can point the user there. */
  module: HealthRecommendationModule;
  /** Advice only: nothing is changed until the user acts on it. */
  requiresConfirmation: true;
}

export interface FinancialHealthOverallDto {
  status: 'scored' | 'insufficient_data';
  /** Weighted average over scored groups, renormalised by available weight. */
  score: number | null;
  classification: HealthClassification;
  /** Sum of the weights of the scored groups. */
  availableWeight: number;
  /** Sum of every configured weight (always 100). */
  totalWeight: number;
  weightedScore: number | null;
  explanation: string;
}

export interface FinancialHealthDataQualityDto {
  level: HealthDataQuality;
  monthsWithData: number;
  completeMonthsConsidered: number;
  transactionCount: number;
  scoredGroups: number;
  totalGroups: number;
}

/** Context every financial-health response carries. */
export interface FinancialHealthMetadataDto {
  currency: string;
  timezone: string;
  /** Today's date in the user's timezone. */
  asOf: string;
  generatedAt: string;
  /** True: the figures are computed estimates, not recorded transactions. */
  estimated: true;
  /** The total-score formula, in words, shown next to the score. */
  formula: string;
  scoringRules: string[];
  dataQuality: FinancialHealthDataQualityDto;
  assumptions: string[];
  limitations: string[];
}

export interface FinancialHealthDto extends FinancialHealthMetadataDto {
  overall: FinancialHealthOverallDto;
  groups: HealthGroupDto[];
  recommendations: HealthRecommendationDto[];
  /** Full history needs persisted snapshots; this response is the live view. */
  historyAvailable: false;
}

export interface FinancialHealthContributionDto {
  group: HealthGroupKey;
  score: number;
  weight: number;
  contribution: number;
}

export interface FinancialHealthBreakdownDto extends FinancialHealthMetadataDto {
  overall: FinancialHealthOverallDto;
  groups: HealthGroupDto[];
  contributions: FinancialHealthContributionDto[];
  availableWeight: number;
  missingGroups: Array<{ group: HealthGroupKey; reason: string }>;
  recommendations: HealthRecommendationDto[];
}

/**
 * One month of the recomputed history. Only the cash-flow and budget groups can
 * be rebuilt from stored data for a past month; the other three need a saved
 * snapshot and are therefore marked unavailable rather than guessed.
 */
export interface FinancialHealthHistoryPointDto {
  month: string;
  income: string;
  expense: string;
  net: string;
  savingsRate: number | null;
  hasTransactions: boolean;
  cashFlow: HealthGroupDto;
  budget: HealthGroupDto;
}

export interface FinancialHealthHistoryDto {
  currency: string;
  timezone: string;
  asOf: string;
  generatedAt: string;
  /** Computed on demand from stored data; no snapshots are persisted. */
  method: 'recomputed';
  months: FinancialHealthHistoryPointDto[];
  /** The only groups that can be rebuilt for a past month. */
  availableGroups: ['cash-flow', 'budget'];
  /** No historical total: the other three groups are snapshot-only. */
  overall: null;
  limitations: string[];
}

/**
 * Personalized savings recommendations (M2c).
 *
 * Rule-based only: every figure is derived from the user's stored transactions
 * and their own ACTIVE goals in one currency. Recommendations are suggestions —
 * nothing is written to the database and no contribution is created.
 */
export type SavingsRecommendationStatus = 'available' | 'no_capacity' | 'insufficient_data';

/** Why no capacity could be suggested. `null` when a capacity was computed. */
export type SavingsRecommendationReason = 'no_complete_months' | 'no_income' | null;

export type GoalFeasibility = 'ON_TRACK' | 'AT_RISK' | 'NOT_FEASIBLE' | 'INSUFFICIENT_DATA';

export interface SavingsCapacityDto {
  status: SavingsRecommendationStatus;
  reason: SavingsRecommendationReason;
  currency: string;
  /** Completed months that actually had transactions (up to 6). */
  monthsAnalyzed: number;
  /** Those months, oldest first (YYYY-MM). */
  analyzedMonths: string[];
  averageMonthlyIncome: string | null;
  averageMonthlyExpense: string | null;
  averageNetCashFlow: string | null;
  /** net / income × 100 over the analysed months, or null without income. */
  historicalSavingsRate: number | null;
  /** Share of the average net cash flow kept as an unallocated safety buffer. */
  safetyBufferPercent: number;
  safetyBufferAmount: string | null;
  /** Suggested monthly saving after the safety buffer; null when data is insufficient. */
  suggestedMonthlySaving: string | null;
  isPositive: boolean;
  confidence: 'high' | 'medium' | 'low';
}

export interface SavingsRecommendationItemDto {
  goalId: string;
  goalName: string;
  currency: string;
  /** ACTIVE, or OVERDUE when its target date has passed. */
  displayStatus: GoalDisplayStatus;
  targetDate: string | null;
  monthsRemaining: number | null;
  remainingAmount: string;
  requiredMonthlySaving: string | null;
  /** Allocation from the effective budget; null when the data is insufficient. */
  recommendedMonthlySaving: string | null;
  /** Projected completion date (YYYY-MM-DD); null without a positive allocation. */
  estimatedCompletionDate: string | null;
  feasibility: GoalFeasibility;
  /** 1-based position in the priority order. */
  priority: number;
  priorityReason: string;
  explanation: string;
}

export interface SavingsRecommendationsDto {
  currency: string;
  timezone: string;
  /** ISO instant the analysis was computed at. */
  generatedAt: string;
  /** Mirrors `capacity.status` for convenience. */
  status: SavingsRecommendationStatus;
  capacity: SavingsCapacityDto;
  /** Budget the allocation used: the suggested capacity or the simulated amount. */
  monthlyBudget: string | null;
  /** True when the user supplied their own monthly saving to simulate. */
  simulated: boolean;
  simulatedMonthlySaving: string | null;
  items: SavingsRecommendationItemDto[];
  allocatedMonthly: string;
  /** Budget left after every allocation; null when there is no budget. */
  unallocatedMonthly: string | null;
  excluded: { paused: number; completed: number; archived: number };
  assumptions: string[];
  limitations: string[];
}

/**
 * Savings progress tracking and plan adjustment (M2d).
 *
 * Progress is measured from the contributions actually recorded (never
 * estimated), while "expected" is the linear plan between start and deadline
 * and "projected" extrapolates the observed contribution pace. Simulations and
 * previews are read-only: only an explicit adjustment writes a goal field, and
 * no contribution is ever created or removed.
 */
export type SavingsProgressStatus =
  'ON_TRACK' | 'AT_RISK' | 'OVERDUE' | 'COMPLETED' | 'PAUSED' | 'INSUFFICIENT_DATA';

export type SimulationScenario =
  'MONTHLY_AMOUNT' | 'DEADLINE' | 'TARGET_AMOUNT' | 'MULTI_GOAL_BUDGET';

export type SimulationFeasibility = 'FEASIBLE' | 'NOT_FEASIBLE' | 'INSUFFICIENT_DATA';

/** One point of the cumulative chart: what was saved versus what the plan expected. */
export interface GoalProgressTimelinePointDto {
  /** Calendar month in the user's timezone, YYYY-MM. */
  month: string;
  /** Cumulative contributions through the end of that month. */
  actualSaved: string;
  /** Planned cumulative amount at the same date (linear plan). */
  expectedSaved: string;
}

export interface GoalPaceDto {
  /** Calendar months from the start date to today; at least 1. */
  monthsObserved: number;
  /** saved / monthsObserved, or null without any contribution. */
  averageMonthlyContribution: string | null;
  /** ceil(remaining / average); 0 when fully funded; null without a pace. */
  monthsToComplete: number | null;
  estimatedCompletionDate: string | null;
  /** saved + average × monthsLeft, or null without a pace or a deadline. */
  projectedAmountAtDeadline: string | null;
  /** Whether the projected date is on or before the deadline; null without one. */
  projectedHitsDeadline: boolean | null;
}

export interface GoalProgressDto {
  goalId: string;
  name: string;
  currency: string;
  status: GoalStatus;
  displayStatus: GoalDisplayStatus;
  targetAmount: string;
  /** Actual progress: the sum of real GoalContribution rows. */
  savedAmount: string;
  remainingAmount: string;
  completionPercentage: number;
  startDate: string;
  targetDate: string | null;
  monthsRemaining: number | null;
  requiredMonthlySaving: string | null;
  /** Expected progress: target × elapsed share of the original timeline. */
  expectedAmount: string | null;
  expectedPercentage: number | null;
  /** saved − expected (positive means ahead). Null without a deadline. */
  actualVsExpected: string | null;
  /** Shortfall (expected − saved) exceeds one planned monthly instalment. */
  atRisk: boolean | null;
  aheadOfSchedule: boolean | null;
  /** Projected progress: extrapolated from the observed contribution pace. */
  pace: GoalPaceDto;
  progressStatus: SavingsProgressStatus;
  statusReason: string;
  lastContributionAt: string | null;
  /** Cumulative actual versus expected, from the start month to this month. */
  timeline: GoalProgressTimelinePointDto[];
}

export interface SavingsProgressSummaryDto {
  currency: string;
  /** Stored status ACTIVE, including ones already past their deadline. */
  activeGoals: number;
  onTrack: number;
  atRisk: number;
  overdue: number;
  completed: number;
  paused: number;
  insufficientData: number;
  totalTargetAmount: string;
  totalSavedAmount: string;
  totalRemainingAmount: string;
  /** saved / target × 100 across the goals in this currency. */
  overallPercentage: number;
}

export interface SavingsProgressDto {
  currency: string;
  timezone: string;
  /** Today's calendar date in the user's timezone, YYYY-MM-DD. */
  today: string;
  generatedAt: string;
  asOf: string;
  summary: SavingsProgressSummaryDto;
  goals: GoalProgressDto[];
  excluded: { archived: number };
  /** The deterministic classification rules, in words, so the UI can explain them. */
  rules: string[];
  limitations: string[];
}

export interface ContributionHistoryItemDto {
  id: string;
  goalId: string;
  goalName: string;
  amount: string;
  contributedAt: string;
  note: string | null;
}

export interface ContributionMonthDto {
  month: string;
  amount: string;
  count: number;
  /** Cumulative total through this month, including `openingAmount`. */
  cumulativeAmount: string;
}

export interface ContributionHistoryDto {
  currency: string;
  timezone: string;
  /** Length of the window in months, matching the number of `months` points. */
  monthCount: number;
  fromMonth: string;
  toMonth: string;
  /** The goal filter applied, or null for every goal in the currency. */
  goalId: string | null;
  /** Contributions before the window, so the cumulative line starts correctly. */
  openingAmount: string;
  totalAmount: string;
  totalCount: number;
  /** Oldest first; empty months are present with zero. */
  months: ContributionMonthDto[];
  /** Newest first, capped so one response cannot grow without bound. */
  items: ContributionHistoryItemDto[];
  truncated: boolean;
  limitations: string[];
}

/** The figures of one plan. Saved amounts are never changed by a simulation. */
export interface PlanFiguresDto {
  targetAmount: string;
  savedAmount: string;
  remainingAmount: string;
  completionPercentage: number;
  targetDate: string | null;
  monthsRemaining: number | null;
  requiredMonthlySaving: string | null;
  /** The monthly amount the projection assumes. */
  monthlySaving: string | null;
  monthsToComplete: number | null;
  estimatedCompletionDate: string | null;
  deadlineMet: boolean | null;
}

export interface GoalCapacityReferenceDto {
  available: boolean;
  /** M2c suggested capacity for this currency, when one could be computed. */
  monthlySaving: string | null;
  /** requiredMonthlySaving ≤ capacity; null when either side is unknown. */
  requiredWithinCapacity: boolean | null;
}

export interface SingleGoalSimulationDto {
  scenario: 'MONTHLY_AMOUNT' | 'DEADLINE' | 'TARGET_AMOUNT';
  currency: string;
  timezone: string;
  generatedAt: string;
  goalId: string;
  goalName: string;
  current: PlanFiguresDto;
  simulated: PlanFiguresDto;
  difference: {
    targetAmount: string;
    remainingAmount: string;
    requiredMonthlySaving: string | null;
    monthlySaving: string | null;
    completionDateShiftMonths: number | null;
  };
  capacity: GoalCapacityReferenceDto;
  feasibility: SimulationFeasibility;
  feasibilityReason: string;
  warnings: string[];
  limitations: string[];
}

export interface MultiGoalSimulationDifferenceDto {
  goalId: string;
  goalName: string;
  baselineMonthlySaving: string | null;
  simulatedMonthlySaving: string | null;
  /** simulated − baseline; null when either is unknown. */
  deltaMonthlySaving: string | null;
}

export interface MultiGoalSimulationDto {
  scenario: 'MULTI_GOAL_BUDGET';
  currency: string;
  timezone: string;
  generatedAt: string;
  budget: string;
  capacityMonthlySaving: string | null;
  baseline: {
    budget: string | null;
    status: SavingsRecommendationStatus;
    allocatedMonthly: string;
    unallocatedMonthly: string | null;
    items: SavingsRecommendationItemDto[];
  };
  simulated: {
    allocatedMonthly: string;
    unallocatedMonthly: string | null;
    items: SavingsRecommendationItemDto[];
    infeasibleGoalIds: string[];
  };
  differences: MultiGoalSimulationDifferenceDto[];
  assumptions: string[];
  limitations: string[];
}

export type SavingsSimulationDto = SingleGoalSimulationDto | MultiGoalSimulationDto;

export type AdjustmentField = 'targetAmount' | 'targetDate';

export interface AdjustmentChangeDto {
  field: AdjustmentField;
  oldValue: string;
  newValue: string;
}

export interface AdjustmentPreviewDto {
  goalId: string;
  goalName: string;
  currency: string;
  timezone: string;
  changes: AdjustmentChangeDto[];
  /** Blocking reasons: when not empty, `canApply` is false. */
  problems: string[];
  warnings: string[];
  current: GoalProgressDto;
  projected: GoalProgressDto;
  canApply: boolean;
}

export interface AdjustmentAppliedDto {
  goal: GoalDto;
  progress: GoalProgressDto;
}

/**
 * AI savings assistant (M2e).
 *
 * Every financial value in these responses comes from the deterministic
 * backend (M2c capacity/allocation, M2d progress and simulations). The AI layer
 * receives that structured context and may only explain, summarise and suggest;
 * `source` says which layer wrote a given piece of text, and `disclosure` says
 * where (if anywhere) the data was sent.
 */
export type AiTextSource = 'AI' | 'FALLBACK';

export type AiFallbackReason =
  | 'disabled'
  | 'not_configured'
  | 'timeout'
  | 'rate_limited'
  | 'provider_error'
  | 'invalid_response'
  | 'not_needed'
  | null;

export interface AiDisclosureDto {
  /** True when a model provider is configured for this deployment. */
  aiEnabled: boolean;
  /** Provider name, e.g. `anthropic`; null when disabled. */
  provider: string | null;
  model: string | null;
  /** True when the text in this response was written by the model. */
  usedModel: boolean;
  fallbackReason: AiFallbackReason;
  /** Short Vietnamese notice about why no model was used. */
  notice: string;
}

export interface AiEvidenceDto {
  /** Human-readable label, e.g. `Dòng tiền ròng trung bình`. */
  label: string;
  /** Value as formatted by the backend; never written by the model. */
  value: string;
}

export interface SavingsExplanationGoalDto {
  goalId: string;
  goalName: string;
  /** M2c priority (1 = first); null when the goal is not allocated. */
  priority: number | null;
  priorityReason: string;
  progressStatus: SavingsProgressStatus;
  statusReason: string;
  targetDate: string | null;
  remainingAmount: string;
  requiredMonthlySaving: string | null;
  recommendedMonthlySaving: string | null;
  estimatedCompletionDate: string | null;
  feasibility: GoalFeasibility | null;
  atRisk: boolean | null;
}

export interface SavingsExplanationSectionDto {
  title: string;
  body: string;
}

export interface SavingsExplanationFactsDto {
  currency: string;
  capacityStatus: SavingsRecommendationStatus;
  capacityReason: SavingsRecommendationReason;
  monthsAnalyzed: number;
  analyzedMonths: string[];
  averageMonthlyIncome: string | null;
  averageMonthlyExpense: string | null;
  averageNetCashFlow: string | null;
  historicalSavingsRate: number | null;
  safetyBufferPercent: number;
  safetyBufferAmount: string | null;
  monthlyBudget: string | null;
  allocatedMonthly: string;
  unallocatedMonthly: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface SavingsExplanationDto {
  currency: string;
  timezone: string;
  today: string;
  generatedAt: string;
  source: AiTextSource;
  summary: string;
  facts: SavingsExplanationFactsDto;
  goals: SavingsExplanationGoalDto[];
  sections: SavingsExplanationSectionDto[];
  limitations: string[];
  disclosure: AiDisclosureDto;
}

export interface SavingsSuggestionDto {
  id: string;
  title: string;
  explanation: string;
  /** Backend-computed evidence; the model can only select which facts to cite. */
  evidence: AiEvidenceDto[];
  expectedImpact: string;
  goalIds: string[];
  confidence: 'high' | 'medium' | 'low';
  limitations: string[];
  /** True for anything the user must apply themselves (always true today). */
  requiresConfirmation: boolean;
}

export interface SavingsSuggestionsDto {
  currency: string;
  timezone: string;
  generatedAt: string;
  source: AiTextSource;
  suggestions: SavingsSuggestionDto[];
  limitations: string[];
  disclosure: AiDisclosureDto;
}

export type SavingsScenarioStatus = 'simulated' | 'clarification' | 'unsupported';

export interface SavingsScenarioInterpretationDto {
  scenario: SimulationScenario | null;
  goalId: string | null;
  goalName: string | null;
  monthlyAmount: string | null;
  targetAmount: string | null;
  targetDate: string | null;
  budget: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface SavingsScenarioExplanationDto {
  status: SavingsScenarioStatus;
  currency: string;
  timezone: string;
  generatedAt: string;
  source: AiTextSource;
  /** The deterministic M2d simulation; null when the intent was not understood. */
  simulation: SavingsSimulationDto | null;
  explanation: string;
  /** The question asked when the intent is ambiguous or information is missing. */
  clarification: string | null;
  interpretation: SavingsScenarioInterpretationDto;
  /** Applying a change always needs the M2d preview and an explicit confirm. */
  requiresConfirmation: boolean;
  limitations: string[];
  disclosure: AiDisclosureDto;
}

export type SavingsChatIntent =
  'EXPLAIN' | 'STATUS' | 'PRIORITY' | 'SCENARIO' | 'UNCLEAR' | 'UNSUPPORTED';

export interface SavingsChatMessageDto {
  role: 'user' | 'assistant';
  content: string;
}

export interface SavingsChatReplyDto {
  currency: string;
  timezone: string;
  generatedAt: string;
  source: AiTextSource;
  intent: SavingsChatIntent;
  reply: string;
  references: AiEvidenceDto[];
  scenario: SavingsSimulationDto | null;
  clarification: string | null;
  /** The assistant has no endpoint that can change data. */
  canModifyData: false;
  disclosure: AiDisclosureDto;
}

export const SAVINGS_CHAT_SUGGESTED_QUESTIONS: readonly string[] = [
  'Tại sao hệ thống đề xuất mức tiết kiệm này?',
  'Mục tiêu nào nên ưu tiên nhất?',
  'Tại sao có mục tiêu đang chậm tiến độ?',
  'Nếu tôi góp 2.000.000 ₫ mỗi tháng thì sao?',
];

/**
 * AI financial analyst (M3e).
 *
 * Same discipline as the savings assistant: every figure in these responses is
 * computed by the deterministic analytics/health/forecast/savings services and
 * shown as `facts`. The model may only explain those figures in prose and cite
 * a closed set of backend-built evidence entries; it never changes a value and
 * has no endpoint that can write data.
 */
export type AnalyticsAiChatIntent =
  | 'SUMMARY'
  | 'EXPLAIN'
  | 'HEALTH'
  | 'FORECAST'
  | 'BUDGET'
  | 'CATEGORY'
  | 'SAVINGS'
  | 'UNSUPPORTED'
  | 'UNCLEAR';

export interface AnalyticsAiCategoryFactDto {
  name: string;
  total: string;
  sharePercent: number;
}

export interface AnalyticsAiFactsDto {
  currency: string;
  timezone: string;
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  income: string;
  expense: string;
  net: string;
  savingsRate: number | null;
  transactionCount: number;
  hasTransactions: boolean;
  /** Complete months behind the trend series; 0 when the trend was not loaded. */
  monthsAnalyzed: number;
  /** Top EXPENSE categories in the period; empty when categories were not loaded. */
  topCategories: AnalyticsAiCategoryFactDto[];
  /** null means "this function did not load budgets/forecast/health/savings". */
  budgetCount: number | null;
  budgetsExceeded: number | null;
  budgetsWarning: number | null;
  forecastStatus: ForecastStatus | null;
  forecastNet: string | null;
  forecastHorizon: ForecastHorizon | null;
  healthStatus: 'scored' | 'insufficient_data' | null;
  healthScore: number | null;
  healthClassification: HealthClassification | null;
  /** Suggested monthly saving from M2c, already formatted; null when not loaded. */
  savingsCapacity: string | null;
}

export interface AnalyticsAiHighlightDto {
  title: string;
  body: string;
  evidence: AiEvidenceDto[];
}

export interface AnalyticsAiBaseDto {
  currency: string;
  timezone: string;
  generatedAt: string;
  source: AiTextSource;
  /** Official figures computed by the backend; the UI labels them "Hệ thống tính". */
  facts: AnalyticsAiFactsDto;
  evidence: AiEvidenceDto[];
  limitations: string[];
  /** The analyst has no endpoint that can change data. */
  canModifyData: false;
  disclosure: AiDisclosureDto;
}

export interface AnalyticsAiSummaryDto extends AnalyticsAiBaseDto {
  summary: string;
  highlights: AnalyticsAiHighlightDto[];
}

export interface AnalyticsAiExplanationDto extends AnalyticsAiBaseDto {
  summary: string;
  sections: SavingsExplanationSectionDto[];
}

export interface AnalyticsAiRecommendationDto {
  id: string;
  title: string;
  detail: string;
  evidence: AiEvidenceDto[];
  expectedImpact: string;
  confidence: 'high' | 'medium' | 'low';
  limitations: string[];
  /** Advice only: nothing is changed until the user acts on it. */
  requiresConfirmation: true;
}

export interface AnalyticsAiRecommendationsDto extends AnalyticsAiBaseDto {
  recommendations: AnalyticsAiRecommendationDto[];
}

export interface AnalyticsAiChatReplyDto extends AnalyticsAiBaseDto {
  intent: AnalyticsAiChatIntent;
  reply: string;
  /** The question asked when the request was too vague; null otherwise. */
  clarification: string | null;
}

export const ANALYTICS_AI_SUGGESTED_QUESTIONS: readonly string[] = [
  'Tóm tắt tình hình tài chính tháng này',
  'Vì sao chi tiêu tháng này tăng?',
  'Ngân sách nào đang vượt hạn mức?',
  'Dự báo dòng tiền tháng này thế nào?',
  'Điểm sức khỏe tài chính được tính ra sao?',
];

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

export const GOAL_FEASIBILITY_LABELS: Record<GoalFeasibility, string> = {
  ON_TRACK: 'Đúng tiến độ',
  AT_RISK: 'Có nguy cơ trễ hạn',
  NOT_FEASIBLE: 'Không khả thi',
  INSUFFICIENT_DATA: 'Chưa đủ dữ liệu',
};

export const SAVINGS_PROGRESS_STATUS_LABELS: Record<SavingsProgressStatus, string> = {
  ON_TRACK: 'Đúng tiến độ',
  AT_RISK: 'Chậm tiến độ',
  OVERDUE: 'Quá hạn',
  COMPLETED: 'Hoàn thành',
  PAUSED: 'Tạm dừng',
  INSUFFICIENT_DATA: 'Chưa đủ dữ liệu',
};

export const SIMULATION_FEASIBILITY_LABELS: Record<SimulationFeasibility, string> = {
  FEASIBLE: 'Khả thi',
  NOT_FEASIBLE: 'Không khả thi',
  INSUFFICIENT_DATA: 'Chưa đủ dữ liệu',
};

export const HEALTH_GROUP_LABELS: Record<HealthGroupKey, string> = {
  'cash-flow': 'Sức khỏe dòng tiền',
  budget: 'Quản lý ngân sách',
  savings: 'Sức khỏe tiết kiệm',
  stability: 'Ổn định tài chính',
  'forecast-risk': 'Rủi ro dự báo',
};

export const HEALTH_CLASSIFICATION_LABELS: Record<HealthClassification, string> = {
  EXCELLENT: 'Xuất sắc',
  GOOD: 'Tốt',
  FAIR: 'Trung bình',
  NEEDS_ATTENTION: 'Cần cải thiện',
  INSUFFICIENT_DATA: 'Chưa đủ dữ liệu',
};
