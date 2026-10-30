import type { AnalyticsExpenseDto, AnalyticsIncomeDto } from '@smart-finance/shared-types';
import { formatMoney, formatMonthLabel, formatPercent } from '../lib/format';
import { ProgressBar } from './ui';

type Props =
  | { kind: 'income'; data: AnalyticsIncomeDto; currency: string }
  | { kind: 'expense'; data: AnalyticsExpenseDto; currency: string };

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-800">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

/**
 * Monthly income (or expense) analysis: totals, per-month change, extremes and
 * — for income — the share of each category. Every figure comes from the API;
 * the panel only formats it.
 *
 * Wording stays descriptive: an increase or decrease is reported as a fact, and
 * the income source is whatever category the user assigned, never inferred from
 * a transaction description.
 */
export function AnalyticsBreakdownPanel(props: Props) {
  const { data, currency } = props;
  const isIncome = props.kind === 'income';
  const monthsWithAmount =
    props.kind === 'income' ? props.data.monthsWithIncome : props.data.monthsWithExpense;
  const amountPoints = data.points.filter((point) => point.hasTransactions);
  const noData = amountPoints.length === 0;
  const title = isIncome ? 'Phân tích thu nhập' : 'Phân tích chi tiêu';

  return (
    <section className="card" aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500">
          {data.rangeMonths} tháng gần nhất · đơn vị {currency} · múi giờ {data.timezone}
        </p>
      </div>

      {noData ? (
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600" role="status">
          Không có giao dịch {isIncome ? 'thu nhập' : 'chi tiêu'} trong khoảng này.
        </p>
      ) : (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Tổng cộng" value={formatMoney(data.total, currency)} />
            <Tile
              label="Trung bình mỗi tháng có phát sinh"
              value={
                data.averageMonthly === null ? '—' : formatMoney(data.averageMonthly, currency)
              }
              hint={`${monthsWithAmount} tháng có ${isIncome ? 'thu' : 'chi'}`}
            />
            <Tile
              label="Tháng cao nhất"
              value={data.highest ? formatMoney(data.highest.amount, currency) : '—'}
              hint={data.highest ? formatMonthLabel(data.highest.month) : undefined}
            />
            <Tile
              label="Tháng thấp nhất"
              value={data.lowest ? formatMoney(data.lowest.amount, currency) : '—'}
              hint={data.lowest ? formatMonthLabel(data.lowest.month) : undefined}
            />
          </div>

          {props.kind === 'expense' ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Tile
                label="Mức biến động (độ lệch chuẩn / trung bình)"
                value={
                  props.data.volatilityPercent === null
                    ? '—'
                    : `${props.data.volatilityPercent.toFixed(2)}%`
                }
                hint={
                  props.data.volatilityPercent === null
                    ? 'Cần ít nhất 2 tháng có chi tiêu để tính.'
                    : 'Chỉ mô tả mức dao động của số tiền chi, không phải đánh giá.'
                }
              />
              <Tile
                label="Tháng tăng liên tiếp"
                value={`Dài nhất: ${props.data.longestIncreasingStreak} tháng`}
                hint={`Đang tiếp diễn ở tháng cuối: ${props.data.currentIncreasingStreak} tháng`}
              />
            </div>
          ) : null}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Số tiền {isIncome ? 'thu nhập' : 'chi tiêu'} theo tháng và mức thay đổi so với tháng
                trước
              </caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Tháng
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Số tiền
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    So với tháng trước
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.points.map((point) => (
                  <tr key={point.month}>
                    <th scope="row" className="py-2 pr-3 text-left font-medium text-slate-700">
                      {formatMonthLabel(point.month)}
                      {point.monthStatus === 'in_progress' ? (
                        <span className="ml-1 text-xs font-normal text-slate-500">
                          (đang diễn ra)
                        </span>
                      ) : null}
                    </th>
                    {point.hasTransactions ? (
                      <>
                        <td className="py-2 pr-3 text-right text-slate-700">
                          {formatMoney(point.amount, currency)}
                        </td>
                        <td className="py-2 text-right text-slate-600">
                          {point.changePercent === null ? '—' : formatPercent(point.changePercent)}
                        </td>
                      </>
                    ) : (
                      <td className="py-2 text-center text-slate-400" colSpan={2}>
                        Không có dữ liệu
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {props.kind === 'income' ? (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-semibold text-slate-800">Cơ cấu nguồn thu theo danh mục</h3>
          {props.data.sources.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              Chưa có thu nhập để phân chia theo danh mục.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {props.data.sources.map((source) => (
                <li key={source.categoryId ?? 'uncategorised'}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium text-slate-800">{source.categoryName}</span>
                    <span className="font-semibold text-slate-900">
                      {formatMoney(source.total, currency)}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <ProgressBar value={source.sharePercent} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {source.sharePercent.toFixed(1)}% tổng thu · {source.transactionCount} giao dịch
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Nguồn thu được nhóm theo danh mục bạn đã gán cho giao dịch; hệ thống không suy đoán
            nguồn thu từ mô tả hay số tiền.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">
          Các chỉ số trên chỉ mô tả diễn biến số tiền chi tiêu trong khoảng đã chọn và không kết
          luận về thói quen chi tiêu của bạn.
        </p>
      )}
    </section>
  );
}
