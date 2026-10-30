import type { AnalyticsPeriodComparisonDto } from '@smart-finance/shared-types';
import { Sparkles } from 'lucide-react';
import { openAiChat } from '../lib/ai-chat-events';
import type { AiChatContext } from '../lib/ai-chat-context';
import { formatMoney, formatPercent, formatPercentMagnitude } from '../lib/format';
import { Badge, HelpTip } from './ui';

type HighlightTone = 'amber' | 'sky' | 'slate';

interface Highlight {
  id: string;
  tone: HighlightTone;
  label: string;
  title: string;
  detail: string;
  question: string;
}

function signedMoney(amount: string, currency: string): string {
  return Number(amount) > 0 ? `+${formatMoney(amount, currency)}` : formatMoney(amount, currency);
}

function rateLabel(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

/**
 * "What stands out this period", limited to values the comparison endpoint
 * already computed: the direction and size of each change, plus the top
 * category movement. Nothing is recalculated and no severity is invented; the
 * colour follows the same direction semantics as the comparison table.
 */
export function AnalyticsHighlights({
  data,
  currency,
  context,
}: {
  data: AnalyticsPeriodComparisonDto;
  currency: string;
  /** Page-level context; the highlight adds its own label, never an id. */
  context?: AiChatContext;
}) {
  const { current, previous, changes, notableCategoryChanges } = data;
  const highlights: Highlight[] = [];

  if (changes.expense.percent !== null && changes.expense.percent !== 0) {
    const increased = changes.expense.percent > 0;
    highlights.push({
      id: 'expense',
      tone: increased ? 'amber' : 'sky',
      label: 'Chi tiêu',
      title: `Chi tiêu ${increased ? 'tăng' : 'giảm'} ${formatPercentMagnitude(
        changes.expense.percent,
      )} so với kỳ trước`,
      detail: `${formatMoney(current.expense, currency)} so với ${formatMoney(previous.expense, currency)} · ${signedMoney(changes.expense.amount, currency)}.`,
      question: 'Chi tiêu của tôi thay đổi thế nào so với kỳ trước và vì sao?',
    });
  }

  if (changes.income.percent !== null && changes.income.percent !== 0) {
    const increased = changes.income.percent > 0;
    highlights.push({
      id: 'income',
      tone: increased ? 'amber' : 'sky',
      label: 'Thu nhập',
      title: `Thu nhập ${increased ? 'tăng' : 'giảm'} ${formatPercentMagnitude(
        changes.income.percent,
      )} so với kỳ trước`,
      detail: `${formatMoney(current.income, currency)} so với ${formatMoney(previous.income, currency)} · ${signedMoney(changes.income.amount, currency)}.`,
      question: 'Thu nhập của tôi thay đổi thế nào so với kỳ trước?',
    });
  }

  if (changes.savingsRatePoints !== null && changes.savingsRatePoints !== 0) {
    const increased = changes.savingsRatePoints > 0;
    highlights.push({
      id: 'savings-rate',
      tone: increased ? 'amber' : 'sky',
      label: 'Tỷ lệ tiết kiệm',
      title: `Tỷ lệ tiết kiệm ${increased ? 'tăng' : 'giảm'} ${Math.abs(
        changes.savingsRatePoints,
      ).toFixed(1)} điểm %`,
      detail: `${rateLabel(current.savingsRate)} so với ${rateLabel(previous.savingsRate)} của kỳ trước.`,
      question: 'Tỷ lệ tiết kiệm của tôi thay đổi vì đâu?',
    });
  }

  const topCategory = notableCategoryChanges[0];
  if (topCategory) {
    const directionLabel =
      topCategory.direction === 'increase'
        ? 'Tăng'
        : topCategory.direction === 'decrease'
          ? 'Giảm'
          : topCategory.direction === 'new'
            ? 'Chi tiêu mới'
            : 'Không còn chi tiêu';
    highlights.push({
      id: `category-${topCategory.categoryId ?? 'none'}`,
      tone:
        topCategory.direction === 'increase' || topCategory.direction === 'new' ? 'amber' : 'sky',
      label: 'Danh mục',
      title: `${topCategory.categoryName}: ${directionLabel.toLowerCase()} ${formatMoney(
        topCategory.currentTotal,
        currency,
      )}`,
      detail: `Kỳ trước ${formatMoney(topCategory.previousTotal, currency)} · ${signedMoney(
        topCategory.changeAmount,
        currency,
      )} (${formatPercent(topCategory.changePercent)}).`,
      question: `Danh mục "${topCategory.categoryName}" thay đổi thế nào so với kỳ trước?`,
    });
  }

  return (
    <section className="card" aria-label="Điểm đáng chú ý">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="card-title flex items-center gap-1.5">
            Điểm đáng chú ý
            <HelpTip label="Điểm đáng chú ý">
              Tóm tắt các thay đổi lớn nhất giữa hai kỳ. Mọi con số lấy nguyên từ phần so sánh do hệ
              thống tính; trang này không tự tính lại.
            </HelpTip>
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Kỳ {current.period.label} so với kỳ {previous.period.label}.
          </p>
        </div>
      </div>

      {highlights.length === 0 ? (
        <p className="mt-3 text-sm text-ink-secondary">
          Không có thay đổi đáng chú ý so với kỳ trước. Chi tiết đầy đủ nằm bên dưới.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {highlights.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-start justify-between gap-3 py-3 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <Badge tone={item.tone}>{item.label}</Badge>
                <p className="mt-1.5 text-sm font-semibold text-ink">{item.title}</p>
                <p className="mt-0.5 text-sm text-ink-secondary">{item.detail}</p>
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm shrink-0"
                onClick={() =>
                  openAiChat({
                    prompt: item.question,
                    assistantType: 'ANALYTICS',
                    context: {
                      ...context,
                      feature: 'highlight',
                      label: item.title,
                      selectedInsight: item.label,
                    },
                  })
                }
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden /> Hỏi AI
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
