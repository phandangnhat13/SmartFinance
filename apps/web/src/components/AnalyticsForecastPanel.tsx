import type {
  AnalyticsForecastDto,
  ForecastCategoryDto,
  ForecastConfidenceLevel,
  ForecastHorizon,
  ForecastModel,
  ForecastReason,
  ForecastSeriesDto,
} from '@smart-finance/shared-types';
import { Info } from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { chartTheme } from '../lib/chartTheme';
import { formatDateTime, formatMoney, formatMonthLabel } from '../lib/format';
import { Badge, EmptyState } from './ui';

type Tone = 'emerald' | 'amber' | 'rose' | 'slate' | 'sky';

const HORIZON_OPTIONS: Array<{ value: ForecastHorizon; label: string }> = [
  { value: 'current_month', label: 'Phần còn lại của tháng này' },
  { value: '1m', label: 'Tháng tới' },
  { value: '3m', label: '3 tháng tới' },
  { value: '6m', label: '6 tháng tới' },
];

const MODEL_LABELS: Record<ForecastModel, string> = {
  historical_average: 'Trung bình lịch sử',
  weighted_moving_average: 'Trung bình có trọng số',
  linear_trend: 'Xu hướng tuyến tính',
};

const CONFIDENCE_META: Record<ForecastConfidenceLevel, { label: string; tone: Tone }> = {
  high: { label: 'Tin cậy cao', tone: 'emerald' },
  medium: { label: 'Tin cậy trung bình', tone: 'amber' },
  low: { label: 'Tin cậy thấp', tone: 'rose' },
};

const REASON_TEXT: Record<Exclude<ForecastReason, null>, string> = {
  no_complete_months:
    'Chưa có tháng nào đã kết thúc với giao dịch thu hoặc chi, nên chưa thể dự báo.',
  too_few_months: 'Cần ít nhất 3 tháng có giao dịch đã kết thúc để dự báo; hiện chưa đủ dữ liệu.',
  no_income: 'Chưa ghi nhận thu nhập trong các tháng đã kết thúc, nên không dự báo thu nhập.',
  no_accounts: 'Chưa có tài khoản nào trong loại tiền này để tính số dư.',
  missing_series:
    'Thiếu chuỗi thu nhập hoặc chi tiêu đủ dữ liệu nên chưa thể tính số dư cuối tháng.',
};

function reasonText(reason: ForecastReason): string {
  return reason ? REASON_TEXT[reason] : 'Không đủ dữ liệu để dự báo.';
}

interface ChartPoint {
  month: string;
  label: string;
  actual: number | null;
  forecast: number | null;
}

/**
 * Actual and forecast points on one axis, never mixed: the months with real
 * transactions carry a bar, the forecast months carry a dashed line, and the
 * partial current month is only ever a forecast.
 */
function buildChartData(series: ForecastSeriesDto): ChartPoint[] {
  const points = new Map<string, ChartPoint>();
  for (const point of series.history) {
    points.set(point.month, {
      month: point.month,
      label: formatMonthLabel(point.month),
      actual: point.hasTransactions ? Number(point.amount) : null,
      forecast: null,
    });
  }
  for (const point of series.months) {
    const existing = points.get(point.month);
    if (existing) {
      existing.forecast = Number(point.amount);
    } else {
      points.set(point.month, {
        month: point.month,
        label: formatMonthLabel(point.month),
        actual: null,
        forecast: Number(point.amount),
      });
    }
  }
  return [...points.values()].sort((left, right) => left.month.localeCompare(right.month));
}

function SeriesChart({
  series,
  title,
  color,
  currency,
  horizonLabel,
}: {
  series: ForecastSeriesDto;
  title: string;
  color: string;
  currency: string;
  horizonLabel: string;
}) {
  const data = buildChartData(series);
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-ink-secondary">{title}</p>
      <div className="h-56 w-full" aria-label={`Biểu đồ ${title.toLowerCase()}: thực tế và dự báo`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11 }} width={70} />
            <Tooltip
              formatter={(value, name) =>
                value === null || value === undefined
                  ? ['—', String(name)]
                  : [formatMoney(Number(value), currency), String(name)]
              }
            />
            <Legend />
            <Bar
              dataKey="actual"
              name="Thực tế"
              fill={color}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="forecast"
              name={`Dự báo (${horizonLabel})`}
              stroke={color}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={{ r: 3 }}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function confidenceMeta(level: ForecastConfidenceLevel) {
  return CONFIDENCE_META[level];
}

function SeriesMeta({ series, currency }: { series: ForecastSeriesDto; currency: string }) {
  if (series.status !== 'ok') {
    return (
      <div className="rounded-xl border border-warning-border bg-warning-soft px-3 py-2 text-xs text-warning-strong">
        {reasonText(series.reason)}
      </div>
    );
  }
  const confidence = confidenceMeta(series.confidence.level);
  const best = series.modelScores
    .filter((score) => score.mae !== null)
    .sort((left, right) => Number(left.mae) - Number(right.mae))[0];

  return (
    <div className="rounded-xl border border-line bg-surface-muted px-3 py-2 text-xs text-ink-secondary">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="sky">Mô hình: {series.model ? MODEL_LABELS[series.model] : '—'}</Badge>
        <Badge tone={confidence.tone}>{confidence.label}</Badge>
        <span>Điểm tin cậy {series.confidence.score}/100</span>
      </div>
      <p className="mt-1">{series.selectedBecause}</p>
      {best ? (
        <p className="mt-1">
          Sai số backtest tốt nhất: MAE {formatMoney(best.mae ?? '0', currency)}
          {best.wapePercent === null ? '' : ` · WAPE ${best.wapePercent.toFixed(1)}%`} ·{' '}
          {best.origins} kỳ kiểm chứng
        </p>
      ) : null}
      <p className="mt-1">
        {series.monthsWithData} tháng có dữ liệu · trung bình{' '}
        {series.monthlyAverage ? formatMoney(series.monthlyAverage, currency) : '—'}
      </p>
    </div>
  );
}

function ForecastTable({
  income,
  expense,
  currency,
}: {
  income: ForecastSeriesDto;
  expense: ForecastSeriesDto;
  currency: string;
}) {
  const months = new Map<
    string,
    { month: string; isPartial: boolean; income: string | null; expense: string | null }
  >();
  for (const point of income.months) {
    months.set(point.month, {
      month: point.month,
      isPartial: point.isPartial,
      income: point.amount,
      expense: null,
    });
  }
  for (const point of expense.months) {
    const row = months.get(point.month) ?? {
      month: point.month,
      isPartial: point.isPartial,
      income: null,
      expense: null,
    };
    row.expense = point.amount;
    row.isPartial = row.isPartial || point.isPartial;
    months.set(point.month, row);
  }
  if (months.size === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Giá trị dự báo theo tháng</caption>
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-muted">
            <th className="py-2 pr-3 font-medium">Tháng</th>
            <th className="py-2 pr-3 font-medium">Thu nhập</th>
            <th className="py-2 pr-3 font-medium">Chi tiêu</th>
            <th className="py-2 font-medium">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {[...months.values()].map((row) => (
            <tr key={row.month} className="border-b border-line last:border-0">
              <td className="py-2 pr-3 text-ink-secondary">{formatMonthLabel(row.month)}</td>
              <td className="py-2 pr-3 text-ink-secondary">
                {row.income === null ? '—' : formatMoney(row.income, currency)}
              </td>
              <td className="py-2 pr-3 text-ink-secondary">
                {row.expense === null ? '—' : formatMoney(row.expense, currency)}
              </td>
              <td className="py-2">
                {row.isPartial ? (
                  <Badge tone="amber">Còn lại của tháng</Badge>
                ) : (
                  <Badge tone="sky">Dự báo</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategoryTable({
  categories,
  currency,
}: {
  categories: ForecastCategoryDto[];
  currency: string;
}) {
  if (categories.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Chưa có danh mục chi tiêu nào đủ 3 tháng dữ liệu để dự báo riêng.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Dự báo chi tiêu theo danh mục</caption>
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-muted">
            <th className="py-2 pr-3 font-medium">Danh mục</th>
            <th className="py-2 pr-3 font-medium">Mô hình</th>
            <th className="py-2 pr-3 font-medium">Số tháng dữ liệu</th>
            <th className="py-2 pr-3 font-medium">Tổng dự báo</th>
            <th className="py-2 font-medium">Tin cậy</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((item) => {
            const meta = confidenceMeta(item.confidence);
            return (
              <tr
                key={item.categoryId ?? item.categoryName}
                className="border-b border-line last:border-0"
              >
                <td className="py-2 pr-3 text-ink-secondary">{item.categoryName}</td>
                <td className="py-2 pr-3 text-ink-secondary">
                  {item.model ? MODEL_LABELS[item.model] : '—'}
                </td>
                <td className="py-2 pr-3 text-ink-secondary">{item.monthsWithData}</td>
                <td className="py-2 pr-3 text-ink-secondary">
                  {item.horizonTotal === null ? '—' : formatMoney(item.horizonTotal, currency)}
                </td>
                <td className="py-2">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Forecast panel (M3c). The heading, the disclaimer and the badges keep the
 * distinction between recorded data and statistical estimates explicit: no
 * forecast figure is ever styled as an actual transaction.
 */
export function AnalyticsForecastPanel({
  data,
  currency,
  horizon,
  onHorizonChange,
}: {
  data: AnalyticsForecastDto;
  currency: string;
  horizon: ForecastHorizon;
  onHorizonChange: (horizon: ForecastHorizon) => void;
}) {
  const horizonLabel =
    HORIZON_OPTIONS.find((option) => option.value === horizon)?.label ?? 'Dự báo';
  const balance = data.monthEndBalance;

  return (
    <section className="card" aria-label="Dự báo tài chính">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Dự báo tài chính</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Tính trên máy chủ từ các tháng đã kết thúc của chính bạn, không dùng AI/LLM và không tạo
            giao dịch.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="forecastHorizon">
            Khoảng dự báo
          </label>
          <select
            id="forecastHorizon"
            className="input"
            value={horizon}
            onChange={(event) => onHorizonChange(event.target.value as ForecastHorizon)}
          >
            {HORIZON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p
        className="mt-3 flex items-start gap-2 rounded-xl border border-warning-border bg-warning-soft px-3 py-2 text-sm font-medium text-warning-strong"
        role="note"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Giá trị dự báo, không phải số liệu thực tế
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <span className="font-medium text-ink-secondary">{data.currency}</span>
        <span>· múi giờ {data.timezone}</span>
        <span>· số liệu đến {data.asOf}</span>
        <span>· tạo lúc {formatDateTime(data.generatedAt, data.timezone)}</span>
        <Badge tone="slate">Kỳ: {horizonLabel}</Badge>
        <Badge tone={data.status === 'ok' ? 'sky' : 'amber'}>
          {data.status === 'ok' ? 'Đủ dữ liệu dự báo' : 'Chưa đủ dữ liệu'}
        </Badge>
      </div>

      {data.status !== 'ok' ? (
        <div className="mt-4">
          <EmptyState
            title="Chưa thể dự báo"
            description={`${reasonText(data.reason)} Cần tối thiểu 3 tháng có giao dịch thu và chi đã kết thúc.`}
          />
          <p className="mt-3 text-xs text-ink-muted">
            Đã xét {data.dataQuality.completeMonthsConsidered} tháng, trong đó{' '}
            {data.dataQuality.monthsWithData} tháng có dữ liệu ({data.dataQuality.continuityPercent}
            % liên tục).
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-line p-3">
              <p className="text-xs text-ink-muted">
                Thu nhập dự báo ({horizonLabel.toLowerCase()})
              </p>
              <p className="mt-1 text-lg font-semibold text-brand-hover">
                {data.income.horizonTotal ? formatMoney(data.income.horizonTotal, currency) : '—'}
              </p>
              <p className="text-xs text-ink-muted">
                Chỉ tính giao dịch thu nhập, không gồm chuyển tiền nội bộ.
              </p>
            </div>
            <div className="rounded-xl border border-line p-3">
              <p className="text-xs text-ink-muted">Chi tiêu dự báo</p>
              <p className="mt-1 text-lg font-semibold text-danger">
                {data.expense.horizonTotal ? formatMoney(data.expense.horizonTotal, currency) : '—'}
              </p>
              <p className="text-xs text-ink-muted">Gồm phần còn lại của tháng hiện tại</p>
            </div>
            <div className="rounded-xl border border-line p-3">
              <p className="text-xs text-ink-muted">Dòng tiền ròng dự báo</p>
              <p
                className={`mt-1 text-lg font-semibold ${
                  data.net.base && Number(data.net.base) < 0 ? 'text-danger' : 'text-info-strong'
                }`}
              >
                {data.net.base ? formatMoney(data.net.base, currency) : '—'}
              </p>
              <p className="text-xs text-ink-muted">
                {data.net.best && data.net.worst
                  ? `Tham khảo (sai số MAE): ${formatMoney(data.net.worst, currency)} → ${formatMoney(data.net.best, currency)}`
                  : 'Chưa đủ kỳ để tính dải sai số.'}
              </p>
            </div>
            <div className="rounded-xl border border-line p-3">
              <p className="text-xs text-ink-muted">Số dư cuối tháng dự kiến</p>
              <p
                className={`mt-1 text-lg font-semibold ${
                  balance.projectedBalance && Number(balance.projectedBalance) < 0
                    ? 'text-danger'
                    : 'text-ink'
                }`}
              >
                {balance.projectedBalance ? formatMoney(balance.projectedBalance, currency) : '—'}
              </p>
              <p className="text-xs text-ink-muted">
                {balance.currentBalance
                  ? `Hiện tại ${formatMoney(balance.currentBalance, currency)} + thu nhập còn lại − chi tiêu còn lại`
                  : 'Chưa có số dư khả dụng.'}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <SeriesChart
              series={data.income}
              title="Thu nhập: thực tế và dự báo"
              color={chartTheme.series.income}
              currency={currency}
              horizonLabel={horizonLabel}
            />
            <SeriesChart
              series={data.expense}
              title="Chi tiêu: thực tế và dự báo"
              color={chartTheme.forecast.expense}
              currency={currency}
              horizonLabel={horizonLabel}
            />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <SeriesMeta series={data.income} currency={currency} />
            <SeriesMeta series={data.expense} currency={currency} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">Giá trị theo tháng</h3>
              <ForecastTable income={data.income} expense={data.expense} currency={currency} />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">Dự báo chi tiêu theo danh mục</h3>
              <CategoryTable categories={data.categoryForecasts} currency={currency} />
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-line bg-surface-muted p-3 text-xs text-ink-secondary">
            <p className="font-medium text-ink-secondary">Cách tính số dư cuối tháng</p>
            <p className="mt-1">
              Số dư hiện tại = số dư ban đầu của {balance.accountsIncluded} tài khoản (gồm{' '}
              {balance.accountsArchived} tài khoản đã lưu trữ) cộng mọi giao dịch đã ghi nhận. Giao
              dịch chuyển tiền nội bộ được cộng trừ cân bằng nên không làm thay đổi tổng số dư.
            </p>
            <p className="mt-1">
              Thu nhập còn lại{' '}
              {balance.remainingIncome ? formatMoney(balance.remainingIncome, currency) : '—'} · chi
              tiêu còn lại{' '}
              {balance.remainingExpense ? formatMoney(balance.remainingExpense, currency) : '—'}.
            </p>
          </div>
        </>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">Chất lượng dữ liệu</h3>
          <ul className="mt-1 space-y-1 text-xs text-ink-secondary">
            <li>
              {data.dataQuality.monthsWithData}/{data.dataQuality.completeMonthsConsidered} tháng đã
              kết thúc có dữ liệu ({data.dataQuality.continuityPercent}% liên tục).
            </li>
            <li>{data.dataQuality.transactionCount} giao dịch thu/chi trong cửa sổ phân tích.</li>
            <li>
              Tháng thiếu dữ liệu:{' '}
              {data.dataQuality.missingMonths.length === 0
                ? 'không có'
                : data.dataQuality.missingMonths.map(formatMonthLabel).join(', ')}
            </li>
            <li>
              Mức chất lượng:{' '}
              {data.dataQuality.level === 'good'
                ? 'tốt'
                : data.dataQuality.level === 'limited'
                  ? 'hạn chế'
                  : 'chưa đủ'}
              .
            </li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-ink">Giả định &amp; giới hạn</h3>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-ink-secondary">
            {[...data.assumptions, ...data.limitations].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
