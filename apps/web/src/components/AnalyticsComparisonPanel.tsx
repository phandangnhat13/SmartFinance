import type {
  AnalyticsCategoryChangeDirection,
  AnalyticsPeriodComparisonDto,
} from '@smart-finance/shared-types';
import { formatMoney, formatPercent } from '../lib/format';
import { Badge } from './ui';

const directionLabels: Record<
  AnalyticsCategoryChangeDirection,
  { label: string; tone: 'amber' | 'sky' | 'slate' }
> = {
  increase: { label: 'Tăng', tone: 'amber' },
  decrease: { label: 'Giảm', tone: 'sky' },
  new: { label: 'Chi tiêu mới', tone: 'sky' },
  removed: { label: 'Không còn chi tiêu', tone: 'slate' },
};

function signedMoney(amount: string, currency: string): string {
  return Number(amount) > 0 ? `+${formatMoney(amount, currency)}` : formatMoney(amount, currency);
}

function savingsRateLabel(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function PeriodStatus({ status }: { status: 'in_progress' | 'complete' }) {
  return (
    <Badge tone={status === 'in_progress' ? 'amber' : 'slate'}>
      {status === 'in_progress' ? 'Đang diễn ra' : 'Đã kết thúc'}
    </Badge>
  );
}

/**
 * Current period versus the immediately preceding period (month, quarter, year
 * or custom range). All differences are computed by the API; the panel prints
 * them and marks missing baselines with "—" instead of an infinite percentage.
 */
export function AnalyticsComparisonPanel({
  data,
  currency,
}: {
  data: AnalyticsPeriodComparisonDto;
  currency: string;
}) {
  const { current, previous, changes } = data;
  const noBaseline = !previous.hasTransactions;

  return (
    <section className="card" aria-label="So sánh với kỳ trước">
      <h2 className="font-semibold text-slate-900">So sánh với kỳ trước</h2>
      <p className="mt-1 text-xs text-slate-500">
        Đơn vị {currency} · múi giờ {data.timezone} · chỉ tính giao dịch thu và chi.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            So sánh thu nhập, chi tiêu, dòng tiền ròng, tỷ lệ tiết kiệm và số giao dịch giữa kỳ hiện
            tại và kỳ trước
          </caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th scope="col" className="py-2 pr-3 font-medium">
                Chỉ số
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                <span className="block text-slate-700">{current.period.label}</span>
                <PeriodStatus status={current.period.status} />
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                <span className="block text-slate-700">{previous.period.label}</span>
                <PeriodStatus status={previous.period.status} />
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Thay đổi
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr>
              <th scope="row" className="py-2 pr-3 text-left font-medium text-slate-700">
                Thu nhập
              </th>
              <td className="py-2 pr-3 text-right text-emerald-700">
                {formatMoney(current.income, currency)}
              </td>
              <td className="py-2 pr-3 text-right text-slate-600">
                {formatMoney(previous.income, currency)}
              </td>
              <td className="py-2 text-right text-slate-700">
                {signedMoney(changes.income.amount, currency)}
                <span className="ml-1 text-xs text-slate-500">
                  ({formatPercent(changes.income.percent)})
                </span>
              </td>
            </tr>
            <tr>
              <th scope="row" className="py-2 pr-3 text-left font-medium text-slate-700">
                Chi tiêu
              </th>
              <td className="py-2 pr-3 text-right text-rose-600">
                {formatMoney(current.expense, currency)}
              </td>
              <td className="py-2 pr-3 text-right text-slate-600">
                {formatMoney(previous.expense, currency)}
              </td>
              <td className="py-2 text-right text-slate-700">
                {signedMoney(changes.expense.amount, currency)}
                <span className="ml-1 text-xs text-slate-500">
                  ({formatPercent(changes.expense.percent)})
                </span>
              </td>
            </tr>
            <tr>
              <th scope="row" className="py-2 pr-3 text-left font-medium text-slate-700">
                Dòng tiền ròng
              </th>
              <td
                className={`py-2 pr-3 text-right ${
                  Number(current.net) < 0 ? 'text-rose-600' : 'text-slate-700'
                }`}
              >
                {formatMoney(current.net, currency)}
              </td>
              <td className="py-2 pr-3 text-right text-slate-600">
                {formatMoney(previous.net, currency)}
              </td>
              <td className="py-2 text-right text-slate-700">
                {signedMoney(changes.net.amount, currency)}
                <span className="ml-1 text-xs text-slate-500">
                  ({formatPercent(changes.net.percent)})
                </span>
              </td>
            </tr>
            <tr>
              <th scope="row" className="py-2 pr-3 text-left font-medium text-slate-700">
                Tỷ lệ tiết kiệm
              </th>
              <td className="py-2 pr-3 text-right text-slate-700">
                {savingsRateLabel(current.savingsRate)}
              </td>
              <td className="py-2 pr-3 text-right text-slate-600">
                {savingsRateLabel(previous.savingsRate)}
              </td>
              <td className="py-2 text-right text-slate-700">
                {changes.savingsRatePoints === null
                  ? '—'
                  : `${changes.savingsRatePoints > 0 ? '+' : ''}${changes.savingsRatePoints.toFixed(1)} điểm %`}
              </td>
            </tr>
            <tr>
              <th scope="row" className="py-2 pr-3 text-left font-medium text-slate-700">
                Số giao dịch
              </th>
              <td className="py-2 pr-3 text-right text-slate-700">{current.transactionCount}</td>
              <td className="py-2 pr-3 text-right text-slate-600">{previous.transactionCount}</td>
              <td className="py-2 text-right text-slate-400">—</td>
            </tr>
          </tbody>
        </table>
      </div>

      {noBaseline ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
          Kỳ trước ({previous.period.label}) chưa có giao dịch thu hoặc chi, nên không thể tính phần
          trăm thay đổi. Các mức chênh lệch bằng tiền vẫn chính xác.
        </p>
      ) : null}

      <div className="mt-5 border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-800">Thay đổi chi tiêu theo danh mục</h3>
        {data.notableCategoryChanges.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            Không có danh mục chi tiêu nào thay đổi giữa hai kỳ.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {data.notableCategoryChanges.map((item) => {
              const badge = directionLabels[item.direction];
              return (
                <li
                  key={item.categoryId ?? 'uncategorised'}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{item.categoryName}</span>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold text-slate-900">
                      {formatMoney(item.currentTotal, currency)}
                    </p>
                    <p className="text-xs text-slate-500">
                      Kỳ trước {formatMoney(item.previousTotal, currency)} ·{' '}
                      {signedMoney(item.changeAmount, currency)} (
                      {formatPercent(item.changePercent)})
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Danh mục thay đổi được tính trên giao dịch chi tiêu và sắp xếp theo mức chênh lệch tuyệt
          đối, tối đa 10 danh mục.
        </p>
      </div>
    </section>
  );
}
