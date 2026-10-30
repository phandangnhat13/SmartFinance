import { DateTime } from 'luxon';

/**
 * Pure forecasting engine (M3c).
 *
 * Three transparent models are computed from completed calendar months:
 * - `historical_average`: mean of the months that actually had transactions.
 * - `weighted_moving_average`: last three data months weighted 3/2/1.
 * - `linear_trend`: ordinary least squares on the data months, only with
 *   enough history.
 *
 * The model is chosen by rolling-origin backtesting (MAE); when there is not
 * enough history to compare models the engine falls back to the simplest one
 * and says so. Nothing here is machine learning, an LLM or a random guess:
 * every number is reproducible from the stored months.
 */

export const MAX_ANALYSIS_MONTHS = 12;
/** Fewer than this many months with data cannot support any forecast. */
export const MIN_DATA_MONTHS = 3;
/** The trend model needs at least this many months with data. */
export const TREND_MIN_MONTHS = 4;
export const MAX_BACKTEST_ORIGINS = 3;
/** A model must be tested on at least this many origins to be selectable. */
export const MIN_SELECTION_ORIGINS = 2;

export type SeriesKey = 'income' | 'expense';

export interface MonthActual {
  month: string;
  income: number;
  expense: number;
  hasTransactions: boolean;
}

export interface TransactionRow {
  occurredAt: Date | string;
  type: 'INCOME' | 'EXPENSE';
  amount: string | number;
}

export interface BacktestScore {
  model: ForecastModel;
  eligible: boolean;
  reason: string | null;
  origins: number;
  mae: number | null;
  wapePercent: number | null;
}

export type ForecastModel = 'historical_average' | 'weighted_moving_average' | 'linear_trend';

export interface SeriesConfidence {
  level: 'high' | 'medium' | 'low';
  score: number;
  basis: string[];
}

export interface SeriesForecast {
  status: 'ok' | 'insufficient_data';
  reason: 'no_complete_months' | 'too_few_months' | 'no_income' | null;
  model: ForecastModel | null;
  scores: BacktestScore[];
  selectedBecause: string | null;
  confidence: SeriesConfidence;
  monthlyAverage: number | null;
  monthsWithData: number;
  months: Array<{ month: string; amount: number }>;
  mae: number | null;
  wapePercent: number | null;
}

const MODEL_ORDER: ForecastModel[] = [
  'historical_average',
  'weighted_moving_average',
  'linear_trend',
];

const MODEL_MIN_MONTHS: Record<ForecastModel, number> = {
  historical_average: MIN_DATA_MONTHS,
  weighted_moving_average: MIN_DATA_MONTHS,
  linear_trend: TREND_MIN_MONTHS,
};

/** "YYYY-MM" for an instant in the given IANA timezone. */
export function monthOf(instant: Date | string, zone: string): string {
  const date = instant instanceof Date ? DateTime.fromJSDate(instant) : DateTime.fromISO(instant);
  return date.setZone(zone).toFormat('yyyy-MM');
}

/** The `count` complete months immediately before `currentMonth`, oldest first. */
export function monthsEndingBefore(
  currentMonth: string,
  count: number = MAX_ANALYSIS_MONTHS,
): string[] {
  const anchor = DateTime.fromFormat(`${currentMonth}-01`, 'yyyy-MM-dd', { zone: 'utc' });
  const months: string[] = [];
  for (let offset = count; offset >= 1; offset -= 1) {
    months.push(anchor.minus({ months: offset }).toFormat('yyyy-MM'));
  }
  return months;
}

/** Calendar months after `lastMonth`: next `count` months, oldest first. */
export function monthsAfter(lastMonth: string, count: number): string[] {
  const anchor = DateTime.fromFormat(`${lastMonth}-01`, 'yyyy-MM-dd', { zone: 'utc' });
  const months: string[] = [];
  for (let offset = 1; offset <= count; offset += 1) {
    months.push(anchor.plus({ months: offset }).toFormat('yyyy-MM'));
  }
  return months;
}

/** The months a horizon covers, relative to the current local month. */
export function horizonMonths(
  currentMonth: string,
  horizon: 'current_month' | '1m' | '3m' | '6m',
): string[] {
  if (horizon === 'current_month') return [currentMonth];
  const count = horizon === '1m' ? 1 : horizon === '3m' ? 3 : 6;
  return monthsAfter(currentMonth, count);
}

function monthOrdinal(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number);
  return year * 12 + (monthNumber - 1);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Buckets INCOME/EXPENSE rows into the given local months. */
export function bucketByMonth(
  rows: TransactionRow[],
  zone: string,
  months: string[],
): MonthActual[] {
  const index = new Map(months.map((month) => [month, months.indexOf(month)]));
  const totals = months.map(() => ({ income: 0, expense: 0, count: 0 }));
  for (const row of rows) {
    const bucket = index.get(monthOf(row.occurredAt, zone));
    if (bucket === undefined) continue;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    if (row.type === 'INCOME') totals[bucket].income += amount;
    else totals[bucket].expense += amount;
    totals[bucket].count += 1;
  }
  return months.map((month, position) => ({
    month,
    income: round(totals[position].income),
    expense: round(totals[position].expense),
    hasTransactions: totals[position].count > 0,
  }));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function weightedMovingAverage(values: number[]): number | null {
  if (values.length < 3) return null;
  const last = values.slice(-3);
  const weights = [3, 2, 1];
  const totalWeight = 6;
  return last.reduce((sum, value, index) => sum + value * weights[index], 0) / totalWeight;
}

interface Regression {
  slope: number;
  intercept: number;
}

function linearRegression(points: Array<{ x: number; y: number }>): Regression | null {
  if (points.length < 2) return null;
  const n = points.length;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / n;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominator += (point.x - meanX) ** 2;
  }
  if (denominator === 0) return null;
  const slope = numerator / denominator;
  return { slope, intercept: meanY - slope * meanX };
}

function predictWith(
  model: ForecastModel,
  training: MonthActual[],
  key: SeriesKey,
  targetMonth: string,
): number | null {
  const values = training.map((month) => month[key]);
  if (training.length < MODEL_MIN_MONTHS[model]) return null;
  if (model === 'historical_average') {
    const average = mean(values);
    return average === null ? null : Math.max(0, average);
  }
  if (model === 'weighted_moving_average') {
    const weighted = weightedMovingAverage(values);
    return weighted === null ? null : Math.max(0, weighted);
  }
  const regression = linearRegression(
    training.map((month) => ({ x: monthOrdinal(month.month), y: month[key] })),
  );
  if (regression === null) return null;
  const predicted = regression.intercept + regression.slope * monthOrdinal(targetMonth);
  return Math.max(0, predicted);
}

function backtest(
  dataMonths: MonthActual[],
  key: SeriesKey,
  model: ForecastModel,
): { origins: number; mae: number | null; wapePercent: number | null; reason: string | null } {
  if (dataMonths.length < MODEL_MIN_MONTHS[model]) {
    return {
      origins: 0,
      mae: null,
      wapePercent: null,
      reason: `Cần ít nhất ${MODEL_MIN_MONTHS[model]} tháng có dữ liệu để kiểm chứng chéo.`,
    };
  }
  const firstOrigin = Math.max(MODEL_MIN_MONTHS[model], dataMonths.length - MAX_BACKTEST_ORIGINS);
  const errors: number[] = [];
  const actuals: number[] = [];
  for (let index = firstOrigin; index < dataMonths.length; index += 1) {
    const training = dataMonths.slice(0, index);
    const predicted = predictWith(model, training, key, dataMonths[index].month);
    if (predicted === null) continue;
    errors.push(Math.abs(predicted - dataMonths[index][key]));
    actuals.push(dataMonths[index][key]);
  }
  if (errors.length === 0) {
    return { origins: 0, mae: null, wapePercent: null, reason: 'Không có kỳ nào để kiểm chứng.' };
  }
  const mae = mean(errors) ?? 0;
  const actualMean = mean(actuals) ?? 0;
  return {
    origins: errors.length,
    mae: round(mae),
    wapePercent: actualMean > 0 ? round((mae / actualMean) * 100) : null,
    reason: null,
  };
}

function buildConfidence(input: {
  monthsWithData: number;
  continuityPercent: number;
  selected: BacktestScore | null;
  level: 'ok' | 'insufficient_data';
}): SeriesConfidence {
  const basis: string[] = [];
  if (input.level === 'insufficient_data') {
    return { level: 'low', score: 0, basis: ['Không đủ tháng hoàn chỉnh để dự báo.'] };
  }
  let score = 0;
  if (input.monthsWithData >= 6) {
    score += 40;
    basis.push(`${input.monthsWithData} tháng có dữ liệu (từ 6 tháng trở lên).`);
  } else if (input.monthsWithData >= 4) {
    score += 25;
    basis.push(`${input.monthsWithData} tháng có dữ liệu (4–5 tháng).`);
  } else {
    score += 10;
    basis.push(`Chỉ ${input.monthsWithData} tháng có dữ liệu.`);
  }

  if (input.selected && input.selected.origins >= MIN_SELECTION_ORIGINS) {
    if ((input.selected.wapePercent ?? 100) <= 20) {
      score += 40;
      basis.push(`Sai số kiểm chứng chéo ${input.selected.wapePercent?.toFixed(1)}% (≤ 20%).`);
    } else if ((input.selected.wapePercent ?? 100) <= 40) {
      score += 25;
      basis.push(`Sai số kiểm chứng chéo ${input.selected.wapePercent?.toFixed(1)}% (20–40%).`);
    } else {
      score += 10;
      basis.push(`Sai số kiểm chứng chéo ${input.selected.wapePercent?.toFixed(1)}% (> 40%).`);
    }
  } else {
    score += 5;
    basis.push('Chưa đủ kỳ để kiểm chứng chéo mô hình.');
  }

  if (input.continuityPercent >= 80) {
    score += 20;
    basis.push(`Dữ liệu liên tục ${input.continuityPercent.toFixed(0)}% các tháng.`);
  } else if (input.continuityPercent >= 50) {
    score += 10;
    basis.push(`Dữ liệu liên tục ${input.continuityPercent.toFixed(0)}% các tháng.`);
  } else {
    basis.push(`Dữ liệu chỉ liên tục ${input.continuityPercent.toFixed(0)}% các tháng.`);
  }

  const capped = Math.min(100, score);
  return {
    level: capped >= 70 ? 'high' : capped >= 45 ? 'medium' : 'low',
    score: capped,
    basis,
  };
}

/**
 * Selects a model by rolling-origin MAE and forecasts every target month.
 * When the user has fewer than three complete months with data, no number is
 * produced: the caller must render an "insufficient data" state instead.
 */
export function forecastSeries(
  actuals: MonthActual[],
  key: SeriesKey,
  targets: string[],
  windowMonths: number = MAX_ANALYSIS_MONTHS,
): SeriesForecast {
  const dataMonths = actuals.filter((month) => month.hasTransactions);
  const monthsWithData = dataMonths.length;
  const continuityPercent = windowMonths > 0 ? round((monthsWithData / windowMonths) * 100) : 0;

  if (monthsWithData === 0) {
    return {
      status: 'insufficient_data',
      reason: 'no_complete_months',
      model: null,
      scores: [],
      selectedBecause: null,
      confidence: buildConfidence({
        monthsWithData,
        continuityPercent,
        selected: null,
        level: 'insufficient_data',
      }),
      monthlyAverage: null,
      monthsWithData,
      months: [],
      mae: null,
      wapePercent: null,
    };
  }

  if (key === 'income' && dataMonths.every((month) => month.income <= 0)) {
    return {
      status: 'insufficient_data',
      reason: 'no_income',
      model: null,
      scores: [],
      selectedBecause: null,
      confidence: buildConfidence({
        monthsWithData,
        continuityPercent,
        selected: null,
        level: 'insufficient_data',
      }),
      monthlyAverage: 0,
      monthsWithData,
      months: [],
      mae: null,
      wapePercent: null,
    };
  }

  if (monthsWithData < MIN_DATA_MONTHS) {
    return {
      status: 'insufficient_data',
      reason: 'too_few_months',
      model: null,
      scores: [],
      selectedBecause: null,
      confidence: buildConfidence({
        monthsWithData,
        continuityPercent,
        selected: null,
        level: 'insufficient_data',
      }),
      monthlyAverage: mean(dataMonths.map((month) => month[key])),
      monthsWithData,
      months: [],
      mae: null,
      wapePercent: null,
    };
  }

  const scores: BacktestScore[] = MODEL_ORDER.map((model) => {
    const result = backtest(dataMonths, key, model);
    return {
      model,
      eligible: dataMonths.length >= MODEL_MIN_MONTHS[model],
      reason: result.reason,
      origins: result.origins,
      mae: result.mae,
      wapePercent: result.wapePercent,
    };
  });

  const maxOrigins = Math.max(0, ...scores.map((score) => score.origins));
  const requiredOrigins = Math.min(MIN_SELECTION_ORIGINS, maxOrigins);
  const comparable = scores.filter(
    (score) => score.eligible && score.origins > 0 && score.origins >= requiredOrigins,
  );

  let selected: BacktestScore;
  let selectedBecause: string;
  if (comparable.length === 0) {
    selected = scores[0];
    selectedBecause =
      'Chưa đủ tháng để kiểm chứng chéo mô hình; dùng trung bình lịch sử (mô hình đơn giản nhất).';
  } else {
    selected = comparable.reduce((best, candidate) => {
      if (candidate.mae === null) return best;
      if (best.mae === null) return candidate;
      if (candidate.mae < best.mae) return candidate;
      if (candidate.mae > best.mae) return best;
      return MODEL_ORDER.indexOf(candidate.model) < MODEL_ORDER.indexOf(best.model)
        ? candidate
        : best;
    }, comparable[0]);
    selectedBecause = `${selected.origins} kỳ kiểm chứng chéo, sai số tuyệt đối trung bình ${selected.mae?.toFixed(2)} là thấp nhất trong các mô hình đủ điều kiện.`;
  }

  const months = targets.map((month) => {
    const predicted = predictWith(selected.model, dataMonths, key, month);
    return { month, amount: round(predicted ?? 0) };
  });

  return {
    status: 'ok',
    reason: null,
    model: selected.model,
    scores,
    selectedBecause,
    confidence: buildConfidence({
      monthsWithData,
      continuityPercent,
      selected,
      level: 'ok',
    }),
    monthlyAverage: mean(dataMonths.map((month) => month[key])),
    monthsWithData,
    months,
    mae: selected.mae,
    wapePercent: selected.wapePercent,
  };
}
