import { useQuery } from '@tanstack/react-query';
import type { SavingsProgressDto, SavingsProgressStatus } from '@smart-finance/shared-types';
import { SAVINGS_PROGRESS_STATUS_LABELS } from '@smart-finance/shared-types';
import { goalsProgress } from '../lib/explanations';
import type { AiChatContext } from '../lib/ai-chat-context';
import { api, errorMessage } from '../lib/api';
import { formatMoney } from '../lib/format';
import { AskAIAction, ExplainButton } from './Explain';
import { Badge, ErrorAlert, ProgressBar, StatCard } from './ui';

const STATUS_ORDER: SavingsProgressStatus[] = [
  'ON_TRACK',
  'AT_RISK',
  'OVERDUE',
  'INSUFFICIENT_DATA',
  'PAUSED',
  'COMPLETED',
];

const STATUS_TONES: Record<SavingsProgressStatus, 'emerald' | 'amber' | 'rose' | 'sky' | 'slate'> =
  {
    ON_TRACK: 'emerald',
    AT_RISK: 'amber',
    OVERDUE: 'rose',
    INSUFFICIENT_DATA: 'slate',
    PAUSED: 'slate',
    COMPLETED: 'sky',
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
export function SavingsProgressDashboard({
  currency,
  context,
}: {
  currency: string;
  context?: AiChatContext;
}) {
  const query = useQuery({
    queryKey: ['savings-progress', currency],
    queryFn: () => api.get<SavingsProgressDto>(`/savings/progress?currency=${currency}`),
    retry: false,
  });

  const data = query.data;

  return (
    <section className="mb-6" aria-label="Tổng quan tiến độ">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-ink">Tổng quan tiến độ</h2>
          <ExplainButton
            explanation={goalsProgress}
            label="Cách tính"
            variant="link"
            context={context}
          />
          <AskAIAction
            prompt="Giải thích tiến độ các mục tiêu tiết kiệm của tôi và mục tiêu nào cần chú ý."
            assistantType="SAVINGS"
            context={context}
            label="Hỏi AI về tiến độ"
          />
        </div>
        {data ? (
          <span className="text-xs text-ink-muted">
            {data.summary.activeGoals} mục tiêu đang thực hiện · cập nhật {data.today}
          </span>
        ) : null}
      </div>

      {query.isLoading ? (
        <p className="text-sm text-ink-muted">Đang tính tiến độ tiết kiệm...</p>
      ) : query.error ? (
        <ErrorAlert message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Tổng mục tiêu"
              value={formatMoney(data.summary.totalTargetAmount, data.currency)}
              hint={`${
                data.summary.activeGoals + data.summary.paused + data.summary.completed
              } mục tiêu đang theo dõi`}
            />
            <StatCard
              label="Đã tiết kiệm"
              value={formatMoney(data.summary.totalSavedAmount, data.currency)}
              valueClass="text-income"
              hint={`${data.summary.onTrack} đúng tiến độ · ${data.summary.atRisk} chậm tiến độ`}
            />
            <StatCard
              label="Còn thiếu"
              value={formatMoney(data.summary.totalRemainingAmount, data.currency)}
              hint={`${data.summary.overdue} quá hạn · ${data.summary.completed} hoàn thành`}
            />
            <StatCard
              label="Tiến độ chung"
              value={`${Math.round(data.summary.overallPercentage)}%`}
              hint={<ProgressBar value={data.summary.overallPercentage} tone="emerald" />}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {STATUS_ORDER.map((status) => {
              const count = countFor(data, status);
              if (count === 0) return null;
              return (
                <Badge key={status} tone={STATUS_TONES[status]}>
                  {SAVINGS_PROGRESS_STATUS_LABELS[status]}: {count}
                </Badge>
              );
            })}
            {data.excluded.archived > 0 ? (
              <span className="text-xs text-ink-muted">
                Đã ẩn {data.excluded.archived} mục tiêu lưu trữ khỏi tổng quan.
              </span>
            ) : null}
          </div>

          <p className="mt-2 text-xs text-ink-muted">
            Số liệu chỉ tính cho mục tiêu bằng {data.currency}; không quy đổi giữa các tiền tệ.
            {data.goals.length === 0
              ? ' Chưa có mục tiêu nào đang theo dõi trong tiền tệ này.'
              : ''}
          </p>

          <details className="mt-3 text-xs text-ink-secondary">
            <summary className="cursor-pointer font-medium text-ink-secondary">
              Cách tính tiến độ
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {data.rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-muted">
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
