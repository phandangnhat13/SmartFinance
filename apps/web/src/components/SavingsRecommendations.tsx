import { useQuery } from '@tanstack/react-query';
import type {
  GoalFeasibility,
  SavingsRecommendationItemDto,
  SavingsRecommendationsDto,
} from '@smart-finance/shared-types';
import { GOAL_FEASIBILITY_LABELS } from '@smart-finance/shared-types';
import { PiggyBank, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, ErrorAlert } from './ui';
import { api, errorMessage } from '../lib/api';
import { formatDate, formatMoney } from '../lib/format';

const MONEY_REGEX = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/;

const FEASIBILITY_TONES: Record<GoalFeasibility, 'emerald' | 'amber' | 'rose' | 'slate'> = {
  ON_TRACK: 'emerald',
  AT_RISK: 'amber',
  NOT_FEASIBLE: 'rose',
  INSUFFICIENT_DATA: 'slate',
};

const CONFIDENCE_LABELS: Record<'high' | 'medium' | 'low', string> = {
  high: 'Độ tin cậy cao',
  medium: 'Độ tin cậy trung bình',
  low: 'Độ tin cậy thấp',
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function GoalAllocation({
  item,
  timezone,
}: {
  item: SavingsRecommendationItemDto;
  timezone: string;
}) {
  const recommended =
    item.recommendedMonthlySaving === null
      ? '—'
      : `${formatMoney(item.recommendedMonthlySaving, item.currency)}/tháng`;

  return (
    <li className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{item.goalName}</p>
          <p className="text-xs text-slate-500">
            Ưu tiên {item.priority} · còn thiếu {formatMoney(item.remainingAmount, item.currency)}
            {item.targetDate
              ? ` · hạn ${formatDate(item.targetDate, timezone)}`
              : ' · không đặt hạn'}
          </p>
        </div>
        <Badge tone={FEASIBILITY_TONES[item.feasibility]}>
          {GOAL_FEASIBILITY_LABELS[item.feasibility]}
        </Badge>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <p className="text-sm text-slate-700">
          Đề xuất: <span className="font-semibold text-slate-900">{recommended}</span>
        </p>
        <p className="text-sm text-slate-700">
          Cần thiết:{' '}
          <span className="font-semibold text-slate-900">
            {item.requiredMonthlySaving === null
              ? '—'
              : `${formatMoney(item.requiredMonthlySaving, item.currency)}/tháng`}
          </span>
        </p>
      </div>

      <p className="mt-2 text-xs text-slate-500">{item.priorityReason}</p>
      <p className="mt-1 text-sm text-slate-600">{item.explanation}</p>

      {item.estimatedCompletionDate ? (
        <p className="mt-1 text-xs text-slate-500">
          Dự kiến hoàn thành: {formatDate(`${item.estimatedCompletionDate}T00:00`, timezone)}
        </p>
      ) : null}

      {item.feasibility === 'NOT_FEASIBLE' ? (
        <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
          Với mức tiết kiệm hiện tại, mục tiêu này khó có thể hoàn thành đúng hạn. Hãy tăng mức tiết
          kiệm, dời hạn chót hoặc giảm số tiền cần.
        </p>
      ) : null}
      {item.feasibility === 'AT_RISK' ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          Mức đề xuất thấp hơn mức cần thiết nên mục tiêu này có thể trễ hạn.
        </p>
      ) : null}
    </li>
  );
}

/**
 * Rule-based saving suggestions for the goals in one currency. The figures come
 * straight from GET /insights/savings-recommendations: nothing is written back,
 * and a simulated amount only re-runs the same allocation on the server.
 */
export function SavingsRecommendations({
  currency,
  timezone,
}: {
  currency: string;
  timezone: string;
}) {
  const [assumedInput, setAssumedInput] = useState('');
  const [assumed, setAssumed] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['savings-recommendations', currency, assumed],
    queryFn: () =>
      api.get<SavingsRecommendationsDto>(
        `/insights/savings-recommendations?currency=${currency}${
          assumed ? `&assumedMonthlySaving=${assumed}` : ''
        }`,
      ),
    retry: false,
  });

  const data = query.data;

  function applySimulation() {
    const value = assumedInput.trim();
    if (!value) {
      setAssumed(null);
      setInputError(null);
      return;
    }
    if (!MONEY_REGEX.test(value) || Number(value) <= 0) {
      setInputError('Nhập số tiền lớn hơn 0, tối đa 2 chữ số thập phân');
      return;
    }
    setInputError(null);
    setAssumed(value);
  }

  function resetSimulation() {
    setAssumed(null);
    setAssumedInput('');
    setInputError(null);
  }

  return (
    <section className="card mb-6" aria-label="Đề xuất tiết kiệm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <PiggyBank className="h-4 w-4 text-emerald-600" aria-hidden />
          <h2 className="text-sm font-semibold text-slate-900">Đề xuất tiết kiệm</h2>
        </div>
        <Link to="/insights" className="text-xs font-medium text-sky-700 hover:underline">
          Xem phân tích tài chính
        </Link>
      </div>

      {query.isLoading ? (
        <p className="mt-3 text-sm text-slate-500">Đang tính đề xuất tiết kiệm...</p>
      ) : query.error ? (
        <div className="mt-3">
          <ErrorAlert message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        </div>
      ) : data ? (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Khả năng tiết kiệm/tháng"
              value={
                data.capacity.suggestedMonthlySaving === null
                  ? '—'
                  : formatMoney(data.capacity.suggestedMonthlySaving, data.currency)
              }
              hint={CONFIDENCE_LABELS[data.capacity.confidence]}
            />
            <Stat
              label="Thu nhập TB/tháng"
              value={
                data.capacity.averageMonthlyIncome === null
                  ? '—'
                  : formatMoney(data.capacity.averageMonthlyIncome, data.currency)
              }
            />
            <Stat
              label="Chi tiêu TB/tháng"
              value={
                data.capacity.averageMonthlyExpense === null
                  ? '—'
                  : formatMoney(data.capacity.averageMonthlyExpense, data.currency)
              }
            />
            <Stat
              label="Số tháng đã dùng"
              value={`${data.capacity.monthsAnalyzed} tháng`}
              hint={
                data.capacity.analyzedMonths.length > 0
                  ? data.capacity.analyzedMonths.join(', ')
                  : 'chưa có tháng nào đã kết thúc'
              }
            />
          </div>

          {data.status === 'available' ? (
            <p className="mt-3 text-sm text-slate-700">
              Dựa trên {data.capacity.monthsAnalyzed} tháng đã kết thúc có giao dịch, bạn có thể
              dành khoảng{' '}
              <span className="font-semibold text-slate-900">
                {formatMoney(data.capacity.suggestedMonthlySaving ?? '0', data.currency)}/tháng
              </span>
              . Đây là dòng tiền ròng trung bình{' '}
              {formatMoney(data.capacity.averageNetCashFlow ?? '0', data.currency)} trừ{' '}
              {data.capacity.safetyBufferPercent}% dự phòng an toàn (
              {formatMoney(data.capacity.safetyBufferAmount ?? '0', data.currency)}).
            </p>
          ) : data.status === 'no_capacity' ? (
            <p className="mt-3 text-sm text-amber-800">
              Dòng tiền ròng trung bình trong {data.capacity.monthsAnalyzed} tháng đã kết thúc không
              dương, nên hiện chưa thể đề xuất mức tiết kiệm. Hãy ghi nhận thêm thu nhập hoặc giảm
              chi tiêu trước khi đặt thêm mục tiêu.
            </p>
          ) : (
            <p className="mt-3 text-sm text-slate-600">
              {data.capacity.reason === 'no_income'
                ? `Chưa ghi nhận thu nhập ${data.currency} trong các tháng đã kết thúc nên chưa thể đề xuất mức tiết kiệm.`
                : `Chưa có tháng nào đã kết thúc với giao dịch ${data.currency}. Cần ít nhất một tháng có thu nhập để tính khả năng tiết kiệm.`}
            </p>
          )}

          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Phân bổ theo mục tiêu</h3>
              <span className="text-xs text-slate-500">
                {data.monthlyBudget === null
                  ? 'Chưa có ngân sách để phân bổ'
                  : `Ngân sách ${formatMoney(data.monthlyBudget, data.currency)}/tháng · đã phân bổ ${formatMoney(data.allocatedMonthly, data.currency)}${
                      data.unallocatedMonthly === null
                        ? ''
                        : ` · còn ${formatMoney(data.unallocatedMonthly, data.currency)}`
                    }`}
              </span>
            </div>

            {data.items.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                Không có mục tiêu đang thực hiện nào trong {data.currency} để đề xuất.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-100">
                {data.items.map((item) => (
                  <GoalAllocation key={item.goalId} item={item} timezone={timezone} />
                ))}
              </ul>
            )}

            {(data.excluded.paused > 0 ||
              data.excluded.completed > 0 ||
              data.excluded.archived > 0) && (
              <p className="mt-2 text-xs text-slate-500">
                Không phân bổ cho {data.excluded.paused} mục tiêu tạm dừng,{' '}
                {data.excluded.completed} mục tiêu hoàn thành và {data.excluded.archived} mục tiêu
                lưu trữ.
              </p>
            )}
          </div>

          <form
            className="mt-4 border-t border-slate-100 pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              applySimulation();
            }}
          >
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-52 flex-col gap-1 text-sm text-slate-600">
                <span>Mức tiết kiệm giả định mỗi tháng</span>
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder="3000000"
                  value={assumedInput}
                  onChange={(event) => setAssumedInput(event.target.value)}
                />
              </label>
              <button type="submit" className="btn-secondary">
                <Sparkles className="h-4 w-4" aria-hidden /> Mô phỏng
              </button>
              {data.simulated ? (
                <button type="button" className="btn-secondary" onClick={resetSimulation}>
                  Bỏ mô phỏng
                </button>
              ) : null}
            </div>
            {inputError ? <p className="mt-1 text-xs text-rose-700">{inputError}</p> : null}
            {data.simulated && data.simulatedMonthlySaving !== null ? (
              <p className="mt-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800">
                Đang mô phỏng với {formatMoney(data.simulatedMonthlySaving, data.currency)}/tháng.
                Đây chỉ là giả định để xem trước; không mục tiêu hay khoản góp nào được ghi lại.
              </p>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                Nhập một mức khác để xem trước cách phân bổ thay đổi. Việc mô phỏng không tạo khoản
                góp nào.
              </p>
            )}
          </form>

          <p className="mt-3 text-xs text-slate-500">
            Đây là đề xuất dựa trên quy tắc từ dữ liệu bạn đã ghi nhận, không phải cam kết. Ứng dụng
            không tự tạo khoản góp hay sửa mục tiêu; bạn tự quyết định có làm theo hay không.
          </p>

          <details className="mt-3 text-xs text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">
              Giả định và giới hạn của đề xuất
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {data.assumptions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-500">
              {data.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
    </section>
  );
}
