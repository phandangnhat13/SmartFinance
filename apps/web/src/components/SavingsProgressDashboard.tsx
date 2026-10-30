import { useQuery } from '@tanstack/react-query';
import type { SavingsProgressDto, SavingsProgressStatus } from '@smart-finance/shared-types';
import { SAVINGS_PROGRESS_STATUS_LABELS } from '@smart-finance/shared-types';
import { ErrorAlert, ProgressBar } from './ui';
import { api, errorMessage } from '../lib/api';
import { formatMoney } from '../lib/format';

const STATUS_ORDER: SavingsProgressStatus[] = [
  'ON_TRACK',
  'AT_RISK',
  'OVERDUE',
  'INSUFFICIENT_DATA',
  'PAUSED',
  'COMPLETED',
];

const STATUS_TONES: Record<SavingsProgressStatus, string> = {
  ON_TRACK: 'bg-emerald-50 text-emerald-700',
  AT_RISK: 'bg-amber-50 text-amber-800',
  OVERDUE: 'bg-rose-50 text-rose-700',
  INSUFFICIENT_DATA: 'bg-slate-100 text-slate-600',
  PAUSED: 'bg-slate-100 text-slate-600',
  COMPLETED: 'bg-sky-50 text-sky-700',
};

function countFor(data: SavingsProgressDto, status: SavingsProgressStatus): number {
  switch (status) {
    case 'ON_TRACK':
      return data.summary.onTrack;
    case 'AT_RISK':
      return data.summary.atRisk;
    case 'OVERDUE':
      return data.summary.overdue;
    case 'INSUFFICIENT_DATA':
      return data.summary.insufficientData;
    case 'PAUSED':
      return data.summary.paused;
    case 'COMPLETED':
      return data.summary.completed;
  }
}

/**
 * The dashboard for one currency. Every figure comes from GET /savings/progress;
 * the page never adds or converts money itself.
 */
export function SavingsProgressDashboard({ currency }: { currency: string }) {
  const query = useQuery({
    queryKey: ['savings-progress', currency],
    queryFn: () => api.get<SavingsProgressDto>(`/savings/progress?currency=${currency}`),
    retry: false,
  });

  const data = query.data;

  return (
    <section className="mb-6" aria-label="Tổng quan tiến độ">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Tổng quan tiến độ</h2>
        {data ? (
          <span className="text-xs text-slate-500">
            {data.summary.activeGoals} mục tiêu đang thực hiện · cập nhật {data.today}
          </span>
        ) : null}
      </div>

      {query.isLoading ? (
        <p className="text-sm text-slate-500">Đang tính tiến độ tiết kiệm...</p>
      ) : query.error ? (
        <ErrorAlert message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card">
              <p className="text-xs text-slate-500">Tổng mục tiêu</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">
                {formatMoney(data.summary.totalTargetAmount, data.currency)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {data.summary.activeGoals + data.summary.paused + data.summary.completed} mục tiêu
                đang theo dõi
              </p>
            </div>
            <div className="card">
              <p className="text-xs text-slate-500">Đã tiết kiệm</p>
              <p className="mt-1 text-xl font-semibold text-emerald-700">
                {formatMoney(data.summary.totalSavedAmount, data.currency)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {data.summary.onTrack} đúng tiến độ · {data.summary.atRisk} chậm tiến độ
              </p>
            </div>
            <div className="card">
              <p className="text-xs text-slate-500">Còn thiếu</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">
                {formatMoney(data.summary.totalRemainingAmount, data.currency)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {data.summary.overdue} quá hạn · {data.summary.completed} hoàn thành
              </p>
            </div>
            <div className="card">
              <p className="text-xs text-slate-500">Tiến độ chung</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">
                {Math.round(data.summary.overallPercentage)}%
              </p>
              <div className="mt-2">
                <ProgressBar value={data.summary.overallPercentage} tone="emerald" />
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {STATUS_ORDER.map((status) => {
              const count = countFor(data, status);
              if (count === 0) return null;
              return (
                <span
                  key={status}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONES[status]}`}
                >
                  {SAVINGS_PROGRESS_STATUS_LABELS[status]}: {count}
                </span>
              );
            })}
            {data.excluded.archived > 0 ? (
              <span className="text-xs text-slate-500">
                Đã ẩn {data.excluded.archived} mục tiêu lưu trữ khỏi tổng quan.
              </span>
            ) : null}
          </div>

          <p className="mt-2 text-xs text-slate-500">
            Số liệu chỉ tính cho mục tiêu bằng {data.currency}; không quy đổi giữa các tiền tệ.
            {data.goals.length === 0
              ? ' Chưa có mục tiêu nào đang theo dõi trong tiền tệ này.'
              : ''}
          </p>

          <details className="mt-3 text-xs text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">
              Cách tính tiến độ
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {data.rules.map((rule) => (
                <li key={rule}>{rule}</li>
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
