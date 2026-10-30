import type {
  AnalyticsBudgetPaceDto,
  AnalyticsBudgetsDto,
  BudgetAnalyticsItemDto,
  BudgetAnalyticsStatus,
} from '@smart-finance/shared-types';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { chartTheme } from '../lib/chartTheme';
import { formatDateOnly, formatMoney, formatMonthLabel, formatPercent } from '../lib/format';
import { Badge, ProgressBar } from './ui';

type Tone = 'emerald' | 'amber' | 'rose' | 'slate';

const statusMeta: Record<BudgetAnalyticsStatus, { label: string; tone: Tone }> = {
  NOT_STARTED: { label: 'Chưa bắt đầu', tone: 'slate' },
  ON_TRACK: { label: 'Trong mức', tone: 'emerald' },
  WARNING: { label: 'Sắp chạm ngưỡng', tone: 'amber' },
  EXCEEDED: { label: 'Vượt hạn mức', tone: 'rose' },
  COMPLETED: { label: 'Đã kết thúc kỳ', tone: 'slate' },
};

function exhaustionText(item: BudgetAnalyticsItemDto): string {
  switch (item.exhaustionProjection) {
    case 'within_period':
      return item.estimatedExhaustionDate
        ? `Nếu giữ tốc độ chi hiện tại, hạn mức sẽ hết vào khoảng ${formatDateOnly(item.estimatedExhaustionDate)}.`
        : 'Nếu giữ tốc độ chi hiện tại, hạn mức sẽ hết trong kỳ.';
    case 'beyond_period':
      return 'Với tốc độ chi hiện tại, hạn mức sẽ không hết trong kỳ.';
    case 'already_exceeded':
      return 'Hạn mức đã được sử dụng hết hoặc vượt.';
    case 'no_spending':
      return 'Chưa có chi tiêu nên chưa thể ước tính ngày dùng hết hạn mức.';
    case 'not_started':
      return 'Kỳ ngân sách chưa bắt đầu.';
    default:
      return 'Kỳ ngân sách đã kết thúc; không ngoại suy thêm.';
  }
}

function spentColor(item: BudgetAnalyticsItemDto): string {
  if (item.status === 'EXCEEDED') return chartTheme.budget.exceeded;
  if (item.status === 'WARNING') return chartTheme.budget.warning;
  return chartTheme.budget.onTrack;
}

/**
 * Monthly budget progress, utilization and pace. The Budget table has no
 * currency column, so the API reports which currency the limit is read in — the
 * panel prints that assumption instead of hiding it.
 */
export function AnalyticsBudgetPanel({
  data,
  pace,
  currency,
}: {
  data: AnalyticsBudgetsDto;
  pace: AnalyticsBudgetPaceDto;
  currency: string;
}) {
  const paceByBudget = new Map(pace.items.map((item) => [item.budgetId, item]));
  const chartData = data.items.map((item) => ({
    name: item.name,
    limit: Number(item.limitAmount),
    spent: Number(item.spent),
    status: item.status,
  }));

  return (
    <section className="card" aria-label="Ngân sách tháng">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-ink">Ngân sách tháng {formatMonthLabel(data.month)}</h2>
        <p className="text-xs text-ink-muted">
          {data.items.length} ngân sách · đơn vị {currency} · tính đến {formatDateOnly(data.asOf)}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Badge tone="rose">{data.summary.exceededCount} vượt hạn mức</Badge>
        <Badge tone="amber">{data.summary.warningCount} sắp chạm ngưỡng</Badge>
        <Badge tone="emerald">{data.summary.onTrackCount} trong mức</Badge>
        <Badge tone="slate">{data.summary.notStartedCount} chưa bắt đầu</Badge>
        <Badge tone="slate">{data.summary.completedCount} đã kết thúc kỳ</Badge>
      </div>

      {data.items.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-line-strong px-4 py-8 text-center">
          <p className="font-medium text-ink">
            Chưa có ngân sách cho tháng {formatMonthLabel(data.month)}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Tạo ngân sách tháng để theo dõi hạn mức, tốc độ chi và ngày dự kiến dùng hết.
          </p>
          <Link to="/budgets" className="btn-primary mt-3 inline-flex">
            Tạo ngân sách
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-5 h-64 w-full border-t border-line pt-4">
            <h3 className="text-sm font-semibold text-ink">Hạn mức và thực chi</h3>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value: number) => formatMoney(value, currency)} />
                <Legend />
                <Bar
                  dataKey="limit"
                  name="Hạn mức"
                  fill={chartTheme.budget.limit}
                  isAnimationActive={false}
                />
                <Bar dataKey="spent" name="Đã chi" isAnimationActive={false}>
                  {chartData.map((entry, index) => (
                    <Cell key={`${entry.name}-${index}`} fill={spentColor(data.items[index])} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <ul className="mt-4 space-y-4 border-t border-line pt-4">
            {data.items.map((item) => {
              const meta = statusMeta[item.status];
              const itemPace = paceByBudget.get(item.id);
              const usage = item.usagePercent ?? 0;
              return (
                <li key={item.id} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{item.name}</span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      {item.categoryName ? (
                        <span className="text-xs text-ink-muted">· {item.categoryName}</span>
                      ) : null}
                    </div>
                    <span className="text-sm font-semibold text-ink">
                      {formatMoney(item.spent, currency)} /{' '}
                      {formatMoney(item.limitAmount, currency)}
                    </span>
                  </div>

                  <div className="mt-2">
                    <ProgressBar
                      value={usage}
                      tone={
                        item.status === 'EXCEEDED'
                          ? 'rose'
                          : item.status === 'WARNING'
                            ? 'amber'
                            : 'emerald'
                      }
                    />
                  </div>

                  <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-ink-muted">
                    <span>
                      {item.usagePercent === null
                        ? 'Không có hạn mức dương để tính tỷ lệ'
                        : `Đã dùng ${item.usagePercent.toFixed(1)}%`}
                    </span>
                    <span>
                      Còn lại {formatMoney(item.remaining, currency)} · đã qua {item.daysElapsed}/
                      {item.totalDays} ngày · còn {item.daysRemaining} ngày
                    </span>
                  </div>

                  <div className="mt-2 grid gap-2 text-xs text-ink-secondary sm:grid-cols-3">
                    <p>
                      <span className="text-ink-muted">Mức chi tuyến tính đến hôm nay:</span>{' '}
                      {item.expectedSpend ? formatMoney(item.expectedSpend, currency) : '—'}
                    </p>
                    <p>
                      <span className="text-ink-muted">Chênh lệch so với mức tuyến tính:</span>{' '}
                      {item.variance ? formatMoney(item.variance, currency) : '—'}
                    </p>
                    <p>
                      <span className="text-ink-muted">Tốc độ chi:</span>{' '}
                      {item.pacePercent === null ? '—' : formatPercent(item.pacePercent)} so với mức
                      tuyến tính
                    </p>
                  </div>

                  <p className="mt-2 text-xs text-ink-muted">
                    {exhaustionText(item)}
                    {itemPace?.estimatedExhaustionDate
                      ? ' Đây là ước tính ngoại suy tuyến tính từ chi tiêu đã ghi nhận, không phải dự báo chắc chắn.'
                      : ''}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="mt-3 text-xs text-ink-muted">
        Ngân sách không lưu loại tiền tệ: hạn mức được đọc theo {currency} và chỉ chi tiêu cùng loại
        tiền được tính. Hệ thống không tự thay đổi ngân sách. Trạng thái dựa trên các ngưỡng cảnh
        báo của chính ngân sách (thấp nhất dưới 100%) và ngày kết thúc kỳ.
      </p>
    </section>
  );
}
