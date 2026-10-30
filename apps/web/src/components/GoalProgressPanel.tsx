import { useQuery } from '@tanstack/react-query';
import type {
  ContributionHistoryDto,
  GoalDto,
  GoalProgressDto,
  SavingsProgressStatus,
} from '@smart-finance/shared-types';
import { SAVINGS_PROGRESS_STATUS_LABELS } from '@smart-finance/shared-types';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge, ErrorAlert, ProgressBar } from './ui';
import { GoalPlanSimulator } from './GoalPlanSimulator';
import { api, errorMessage } from '../lib/api';
import { chartTheme } from '../lib/chartTheme';
import { formatDate, formatMoney } from '../lib/format';

const HISTORY_MONTHS = 6;

const STATUS_TONES: Record<SavingsProgressStatus, 'emerald' | 'amber' | 'rose' | 'sky' | 'slate'> =
  {
    ON_TRACK: 'emerald',
    AT_RISK: 'amber',
    OVERDUE: 'rose',
    COMPLETED: 'sky',
    PAUSED: 'slate',
    INSUFFICIENT_DATA: 'slate',
  };

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-surface-muted p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

function signedMoney(value: string, currency: string): string {
  const formatted = formatMoney(value, currency);
  return Number(value) > 0 ? `+${formatted}` : formatted;
}

/**
 * Per-goal progress: what was saved versus what the plan expected, the
 * contribution history, and the read-only plan simulator.
 */
export function GoalProgressPanel({ goal, onChanged }: { goal: GoalDto; onChanged: () => void }) {
  const progressQuery = useQuery({
    queryKey: ['savings-goal-progress', goal.id],
    queryFn: () => api.get<GoalProgressDto>(`/savings/progress/${goal.id}`),
    retry: false,
  });

  const historyQuery = useQuery({
    queryKey: ['savings-history', goal.id],
    queryFn: () =>
      api.get<ContributionHistoryDto>(
        `/savings/contribution-history?goalId=${goal.id}&months=${HISTORY_MONTHS}`,
      ),
    retry: false,
  });

  const progress = progressQuery.data;
  const history = historyQuery.data;
  // The goal-progress payload carries calendar dates but not the timezone; the
  // history endpoint, fetched with it, does.
  const timezone = history?.timezone;

  if (progressQuery.isLoading) {
    return <p className="text-sm text-ink-muted">Đang tải tiến độ mục tiêu...</p>;
  }
  if (progressQuery.error) {
    return (
      <ErrorAlert
        message={errorMessage(progressQuery.error)}
        onRetry={() => void progressQuery.refetch()}
      />
    );
  }
  if (!progress) return null;

  const chartData = progress.timeline.map((point) => ({
    label: point.month.slice(2).replace('-', '/'),
    actual: Number(point.actualSaved),
    expected: Number(point.expectedSaved),
  }));

  const isArchived = goal.status === 'ARCHIVED' || goal.displayStatus === 'ARCHIVED';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONES[progress.progressStatus]}>
            {SAVINGS_PROGRESS_STATUS_LABELS[progress.progressStatus]}
          </Badge>
          <span className="text-xs text-ink-muted">{progress.statusReason}</span>
        </div>
        <span className="text-xs text-ink-muted">
          Hoàn thành {progress.completionPercentage}% kế hoạch
        </span>
      </div>

      <ProgressBar value={progress.completionPercentage} tone="emerald" />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Đã tiết kiệm"
          value={formatMoney(progress.savedAmount, progress.currency)}
          hint={
            progress.lastContributionAt
              ? `Lần góp gần nhất ${formatDate(progress.lastContributionAt, timezone)}`
              : 'Chưa có khoản góp nào'
          }
        />
        <Stat
          label="Kỳ vọng theo kế hoạch"
          value={
            progress.expectedAmount === null
              ? '—'
              : formatMoney(progress.expectedAmount, progress.currency)
          }
          hint={
            progress.expectedPercentage === null
              ? 'Mục tiêu chưa có ngày đích'
              : `${progress.expectedPercentage}% kế hoạch tính đến hôm nay`
          }
        />
        <Stat
          label="Chênh lệch thực tế − kỳ vọng"
          value={
            progress.actualVsExpected === null
              ? '—'
              : signedMoney(progress.actualVsExpected, progress.currency)
          }
          hint={
            progress.aheadOfSchedule === null
              ? 'Chưa đủ dữ liệu để so sánh'
              : progress.aheadOfSchedule
                ? 'Đang nhanh hơn kế hoạch'
                : 'Đang chậm hơn kế hoạch'
          }
        />
        <Stat
          label="Còn phải tiết kiệm thêm"
          value={formatMoney(progress.remainingAmount, progress.currency)}
          hint={
            progress.requiredMonthlySaving === null
              ? 'Không tính được mức góp cần thiết'
              : `Cần ${formatMoney(progress.requiredMonthlySaving, progress.currency)}/tháng`
          }
        />
        <Stat
          label="Tốc độ góp thực tế"
          value={
            progress.pace.averageMonthlyContribution === null
              ? '—'
              : `${formatMoney(progress.pace.averageMonthlyContribution, progress.currency)}/tháng`
          }
          hint={`Trong ${progress.pace.monthsObserved} tháng đã quan sát`}
        />
        <Stat
          label="Dự kiến hoàn thành"
          value={
            progress.pace.estimatedCompletionDate === null
              ? '—'
              : formatDate(`${progress.pace.estimatedCompletionDate}T00:00`, timezone)
          }
          hint={
            progress.pace.monthsToComplete === null
              ? 'Cần thêm dữ liệu khoản góp'
              : `Còn khoảng ${progress.pace.monthsToComplete} tháng theo tốc độ hiện tại`
          }
        />
      </div>

      <section className="rounded-xl border border-line p-4">
        <h3 className="text-sm font-semibold text-ink">Thực tế so với kế hoạch</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Luỹ kế đã tiết kiệm so với mức kế hoạch tuyến tính, theo tháng lịch.
        </p>
        {chartData.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">Chưa có dữ liệu để vẽ biểu đồ.</p>
        ) : (
          <div className="mt-4 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: chartTheme.axis.label }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: chartTheme.axis.tick }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tickFormatter={(value: number) =>
                    new Intl.NumberFormat('vi-VN', {
                      notation: 'compact',
                      maximumFractionDigits: 1,
                    }).format(value)
                  }
                />
                <Tooltip formatter={(value: number) => formatMoney(value, progress.currency)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Thực tế"
                  stroke={chartTheme.series.income}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="expected"
                  name="Kỳ vọng"
                  stroke={chartTheme.axis.label}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-line p-4">
        <h3 className="text-sm font-semibold text-ink">Lịch sử góp</h3>
        {historyQuery.isLoading ? (
          <p className="mt-2 text-sm text-ink-muted">Đang tải lịch sử góp...</p>
        ) : historyQuery.error ? (
          <div className="mt-2">
            <ErrorAlert
              message={errorMessage(historyQuery.error)}
              onRetry={() => void historyQuery.refetch()}
            />
          </div>
        ) : history ? (
          <div className="mt-3 space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Số tiền đã góp theo từng tháng trong {HISTORY_MONTHS} tháng gần nhất
                </caption>
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-ink-muted">
                    <th scope="col" className="py-2 pr-3 text-left font-medium">
                      Tháng
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Số khoản
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Đã góp
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Luỹ kế
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.months.map((month) => (
                    <tr key={month.month} className="border-t border-line">
                      <th
                        scope="row"
                        className="py-2 pr-3 text-left font-normal text-ink-secondary"
                      >
                        {month.month}
                      </th>
                      <td className="py-2 pr-3 text-right text-ink-secondary">{month.count}</td>
                      <td className="py-2 pr-3 text-right text-ink-secondary">
                        {formatMoney(month.amount, history.currency)}
                      </td>
                      <td className="py-2 text-right font-medium text-ink">
                        {formatMoney(month.cumulativeAmount, history.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {history.totalCount === 0 ? (
              <p className="text-xs text-ink-muted">
                Chưa có khoản góp nào trong {HISTORY_MONTHS} tháng gần nhất.
              </p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {history.items.slice(0, 8).map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="text-ink-secondary">
                      {formatDate(item.contributedAt, timezone)}
                      {item.note ? <span className="text-ink-muted"> · {item.note}</span> : null}
                    </span>
                    <span className="font-medium text-ink">
                      {formatMoney(item.amount, history.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {history.truncated ? (
              <p className="text-xs text-ink-muted">
                Chỉ hiển thị các khoản góp mới nhất; tổng số vẫn tính đủ.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {isArchived ? (
        <p className="rounded-xl bg-surface-muted p-3 text-xs text-ink-muted">
          Mục tiêu đã lưu trữ nên không thể mô phỏng hay điều chỉnh kế hoạch.
        </p>
      ) : timezone ? (
        <GoalPlanSimulator goal={goal} timezone={timezone} onApplied={onChanged} />
      ) : null}
    </div>
  );
}
