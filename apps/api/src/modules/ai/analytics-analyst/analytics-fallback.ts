import type {
  AnalyticsAiChatIntent,
  AnalyticsAiHighlightDto,
  AnalyticsAiRecommendationDto,
  SavingsExplanationSectionDto,
} from '@smart-finance/shared-types';
import {
  analyticsEvidenceCatalog,
  analyticsEvidenceList,
  type AnalyticsAiContext,
} from './analytics-context';
import { formatAmount } from '../savings-assistant/savings-context';

/**
 * Deterministic Vietnamese analyst (M3e fallback).
 *
 * Used when no model is configured, when the provider fails, times out or
 * returns text that fails validation, and for questions the analyst refuses to
 * answer (data changes). Every sentence is derived from the same structured
 * context the prompts receive, so no figure is ever invented.
 */

const CLASSIFICATION_LABELS: Record<string, string> = {
  EXCELLENT: 'xuất sắc',
  GOOD: 'tốt',
  FAIR: 'trung bình',
  NEEDS_ATTENTION: 'cần cải thiện',
  INSUFFICIENT_DATA: 'chưa đủ dữ liệu',
};

const FORECAST_HORIZON_LABELS: Record<string, string> = {
  current_month: 'phần còn lại của tháng này',
  '1m': 'tháng tới',
  '3m': '3 tháng tới',
  '6m': '6 tháng tới',
};

function money(value: string | null, currency: string): string {
  return value === null ? 'chưa đủ dữ liệu' : formatAmount(value, currency);
}

function cashFlowSentence(context: AnalyticsAiContext): string {
  const { overview, currency } = context;
  const rate =
    overview.savingsRate === null
      ? 'chưa tính được vì chưa có thu nhập'
      : `${overview.savingsRate}%`;
  return (
    `Trong kỳ ${overview.periodLabel}, bạn ghi nhận thu nhập ${formatAmount(overview.income, currency)} ` +
    `và chi tiêu ${formatAmount(overview.expense, currency)}; dòng tiền ròng là ` +
    `${formatAmount(overview.net, currency)}. Tỷ lệ tiết kiệm ${rate}.`
  );
}

function categorySentence(context: AnalyticsAiContext): string {
  if (context.categories.length === 0) {
    return 'Chưa có giao dịch chi tiêu nào trong kỳ để phân tích theo danh mục.';
  }
  const top = context.categories[0];
  return (
    `Danh mục chi nhiều nhất là ${top.name} với ${formatAmount(top.total, context.currency)}, ` +
    `chiếm ${top.sharePercent}% tổng chi tiêu trong kỳ.`
  );
}

function budgetSentence(context: AnalyticsAiContext): string {
  if (!context.budgets) {
    return 'Chưa tải dữ liệu ngân sách cho câu trả lời này.';
  }
  if (context.budgets.count === 0) {
    return 'Bạn chưa đặt ngân sách nào cho tháng này, nên chưa có hạn mức để so sánh.';
  }
  const parts = [
    `Có ${context.budgets.count} ngân sách trong tháng: ${context.budgets.exceeded} vượt hạn mức, ` +
      `${context.budgets.warning} cảnh báo và ${context.budgets.onTrack} trong hạn mức.`,
  ];
  const worst = context.budgets.items[0];
  if (worst) {
    parts.push(
      `Ngân sách cần chú ý nhất là ${worst.name}: đã dùng ${formatAmount(worst.spent, context.currency)} ` +
        `trên ${formatAmount(worst.limitAmount, context.currency)}.`,
    );
  }
  return parts.join(' ');
}

function forecastSentence(context: AnalyticsAiContext): string {
  if (!context.forecast) {
    return 'Chưa tải dữ liệu dự báo cho câu trả lời này.';
  }
  const label = FORECAST_HORIZON_LABELS[context.forecast.horizon] ?? context.forecast.horizon;
  if (context.forecast.status !== 'ok') {
    return (
      'Chưa đủ tháng dữ liệu đã kết thúc để dự báo, nên hệ thống không đưa ra con số ước tính nào. ' +
      'Đây là dữ liệu thiếu, không phải dự báo bằng 0.'
    );
  }
  return (
    `Dự báo cho ${label} là ước tính: thu nhập ${money(
      context.forecast.incomeTotal,
      context.currency,
    )}, chi tiêu ${money(context.forecast.expenseTotal, context.currency)}, dòng tiền ròng ${money(
      context.forecast.netBase,
      context.currency,
    )}. ` +
    (context.forecast.projectedBalance === null
      ? 'Chưa đủ dữ liệu số dư để ước tính số dư cuối tháng.'
      : `Số dư cuối tháng dự kiến ${formatAmount(context.forecast.projectedBalance, context.currency)}.`)
  );
}

function healthSentence(context: AnalyticsAiContext): string {
  if (!context.health) {
    return 'Chưa tải dữ liệu sức khỏe tài chính cho câu trả lời này.';
  }
  if (context.health.status !== 'scored' || context.health.score === null) {
    return (
      'Chưa tính được điểm sức khỏe tài chính vì thiếu dữ liệu ở một số nhóm. ' +
      'Hệ thống không coi nhóm thiếu dữ liệu là 0 điểm.'
    );
  }
  const weakest = [...context.health.groups]
    .filter((group) => group.status === 'scored' && group.score !== null)
    .sort((left, right) => (left.score ?? 0) - (right.score ?? 0))[0];
  return (
    `Điểm sức khỏe tài chính là ${context.health.score}/100, xếp loại ` +
    `${CLASSIFICATION_LABELS[context.health.classification] ?? context.health.classification}, ` +
    `tính trên ${context.health.availableWeight}% trọng số khả dụng.` +
    (weakest ? ` Nhóm thấp nhất là ${weakest.label} với ${weakest.score}/100.` : '')
  );
}

function savingsSentence(context: AnalyticsAiContext): string {
  if (!context.savings) {
    return 'Chưa tải dữ liệu kế hoạch tiết kiệm cho câu trả lời này.';
  }
  if (context.savings.suggestedMonthlySaving === null) {
    return 'Chưa đủ dữ liệu thu nhập để đề xuất mức tiết kiệm mỗi tháng; hệ thống không tạo con số thay thế.';
  }
  return (
    `Kế hoạch tiết kiệm đề xuất ${formatAmount(
      context.savings.suggestedMonthlySaving,
      context.currency,
    )}/tháng` +
    (context.savings.monthlyBudget === null
      ? '.'
      : `, phân bổ ${formatAmount(context.savings.allocatedMonthly, context.currency)} cho ` +
        `${context.savings.activeGoalCount} mục tiêu trong tháng này.`)
  );
}

export function fallbackSummary(context: AnalyticsAiContext): {
  summary: string;
  highlights: AnalyticsAiHighlightDto[];
} {
  const catalog = analyticsEvidenceCatalog(context);
  const highlights: Array<{ title: string; body: string; keys: string[] }> = [
    {
      title: 'Dòng tiền trong kỳ',
      body: cashFlowSentence(context),
      keys: ['overview_income', 'overview_expense', 'overview_net', 'savings_rate'],
    },
    {
      title: 'Chi tiêu theo danh mục',
      body: categorySentence(context),
      keys: ['overview_expense', 'category:1'],
    },
  ];
  if (context.budgets) {
    highlights.push({
      title: 'Ngân sách tháng',
      body: budgetSentence(context),
      keys: ['budgets_summary'],
    });
  }
  if (context.forecast) {
    highlights.push({
      title: 'Dự báo (ước tính)',
      body: forecastSentence(context),
      keys: ['forecast_net', 'forecast_balance'],
    });
  }
  if (context.health) {
    highlights.push({
      title: 'Sức khỏe tài chính',
      body: healthSentence(context),
      keys: ['health_overall'],
    });
  }

  return {
    summary:
      `Tình hình tài chính kỳ ${context.overview.periodLabel} dựa trên ` +
      `${context.overview.transactionCount} giao dịch thu/chi. ` +
      cashFlowSentence(context),
    highlights: highlights.slice(0, 5).map((highlight) => ({
      title: highlight.title,
      body: highlight.body,
      evidence: analyticsEvidenceList(highlight.keys, catalog),
    })),
  };
}

export function fallbackExplanation(context: AnalyticsAiContext): {
  summary: string;
  sections: SavingsExplanationSectionDto[];
  referenceKeys: string[];
} {
  const sections: SavingsExplanationSectionDto[] = [
    { title: 'Dòng tiền', body: cashFlowSentence(context) },
    { title: 'Danh mục chi tiêu', body: categorySentence(context) },
  ];
  if (context.budgets) {
    sections.push({ title: 'Ngân sách', body: budgetSentence(context) });
  }
  if (context.forecast) {
    sections.push({ title: 'Dự báo (ước tính)', body: forecastSentence(context) });
  }
  if (context.health) {
    sections.push({ title: 'Sức khỏe tài chính', body: healthSentence(context) });
  }

  return {
    summary: `Giải thích các chỉ số của kỳ ${context.overview.periodLabel} từ dữ liệu đã ghi nhận.`,
    sections,
    referenceKeys: ['overview_income', 'overview_expense', 'overview_net', 'savings_rate'],
  };
}

interface DraftedRecommendation {
  id: string;
  severity: number;
  title: string;
  detail: string;
  expectedImpact: string;
  keys: string[];
  confidence: 'high' | 'medium' | 'low';
  limitations: string[];
}

export function fallbackRecommendations(context: AnalyticsAiContext): {
  recommendations: AnalyticsAiRecommendationDto[];
  referenceKeys: string[];
} {
  const catalog = analyticsEvidenceCatalog(context);
  const drafts: DraftedRecommendation[] = [];
  const { currency } = context;

  if (context.budgets && context.budgets.exceeded > 0) {
    const exceeded = context.budgets.items.filter((item) => item.status === 'EXCEEDED');
    const names = exceeded.map((item) => item.name).join(', ');
    drafts.push({
      id: 'budget-exceeded',
      severity: 0,
      title: 'Xử lý ngân sách đã vượt hạn mức',
      detail:
        `Có ${context.budgets.exceeded} ngân sách vượt hạn mức tháng này` +
        (names ? `: ${names}.` : '.') +
        ' Bạn có thể giảm chi ở nhóm này hoặc điều chỉnh hạn mức trong màn hình Ngân sách.',
      expectedImpact: 'Giữ chi tiêu trong hạn mức đã đặt; hệ thống không tự thay đổi ngân sách.',
      keys: ['budgets_summary', 'budget_worst'],
      confidence: 'high',
      limitations: ['Ngân sách không lưu loại tiền; hạn mức đang được hiểu theo ' + currency + '.'],
    });
  }

  if (Number(context.overview.net) < 0) {
    drafts.push({
      id: 'negative-cash-flow',
      severity: 1,
      title: 'Cân đối lại thu chi trong kỳ',
      detail:
        `Dòng tiền ròng của kỳ là ${formatAmount(context.overview.net, currency)}, tức chi nhiều hơn thu. ` +
        'Hãy xem lại các danh mục chi lớn nhất trước khi đặt thêm mục tiêu tiết kiệm.',
      expectedImpact: 'Đưa dòng tiền ròng về mức không âm trong các kỳ tiếp theo.',
      keys: ['overview_net', 'overview_expense'],
      confidence: 'high',
      limitations: ['Chỉ phản ánh giao dịch đã ghi nhận trong ứng dụng.'],
    });
  }

  const savingsRate = context.overview.savingsRate;
  if (savingsRate !== null && savingsRate < 20) {
    drafts.push({
      id: 'low-savings-rate',
      severity: 2,
      title: 'Tăng tỷ lệ tiết kiệm',
      detail:
        `Tỷ lệ tiết kiệm trong kỳ là ${savingsRate}%, dưới mốc tham chiếu 20%. ` +
        'Bạn có thể chọn một danh mục chi tiêu để cắt giảm trước.',
      expectedImpact: 'Tăng phần thu nhập còn lại sau chi tiêu; đây là gợi ý, không phải cam kết.',
      keys: ['savings_rate', 'overview_income', 'overview_expense'],
      confidence: 'medium',
      limitations: ['Mốc 20% là quy tắc tham chiếu của hệ thống, không phải chuẩn bắt buộc.'],
    });
  }

  if (
    context.forecast &&
    context.forecast.status === 'ok' &&
    Number(context.forecast.netBase) < 0
  ) {
    drafts.push({
      id: 'forecast-negative',
      severity: 1,
      title: 'Điều chỉnh trước khi dự báo âm',
      detail:
        `Dự báo dòng tiền ròng là ${formatAmount(context.forecast.netBase, currency)} (ước tính), ` +
        'nên phần còn lại của tháng có thể không đủ bù chi. Hãy theo dõi chi tiêu hằng ngày.',
      expectedImpact: 'Giảm khả năng thiếu hụt vào cuối tháng; dự báo chỉ là ước tính.',
      keys: ['forecast_net', 'forecast_quality'],
      confidence: 'medium',
      limitations: ['Dự báo dựa trên các tháng đã kết thúc và không biết sự kiện bất thường.'],
    });
  }

  if (
    context.health &&
    context.health.status === 'scored' &&
    (context.health.classification === 'NEEDS_ATTENTION' ||
      context.health.classification === 'FAIR')
  ) {
    const weakest = [...context.health.groups]
      .filter((group) => group.status === 'scored' && group.score !== null)
      .sort((left, right) => (left.score ?? 0) - (right.score ?? 0))[0];
    drafts.push({
      id: 'health-weakest-group',
      severity: 2,
      title: 'Cải thiện nhóm điểm yếu nhất',
      detail: weakest
        ? `Nhóm ${weakest.label} đang thấp nhất với ${weakest.score}/100. ` +
          'Cải thiện nhóm này có tác động lớn nhất tới điểm tổng.'
        : 'Điểm tổng còn thấp; hãy xem phần phân rã để biết nhóm cần cải thiện.',
      expectedImpact: 'Nâng điểm nhóm yếu và kéo điểm tổng lên theo trọng số.',
      keys: weakest ? ['health_overall', `health:${weakest.key}`] : ['health_overall'],
      confidence: 'medium',
      limitations: ['Điểm sức khỏe là chỉ báo tham khảo, không phải điểm tín dụng.'],
    });
  }

  if (context.savings && context.savings.suggestedMonthlySaving !== null) {
    drafts.push({
      id: 'savings-plan',
      severity: 3,
      title: 'Duy trì mức tiết kiệm đề xuất',
      detail:
        `Hệ thống đề xuất để dành ${formatAmount(
          context.savings.suggestedMonthlySaving,
          currency,
        )} mỗi tháng` +
        (context.savings.monthlyBudget === null
          ? '.'
          : `, đã phân bổ ${formatAmount(context.savings.allocatedMonthly, currency)} cho ` +
            `${context.savings.activeGoalCount} mục tiêu.`),
      expectedImpact: 'Giữ nhịp tiết kiệm đều đặn để các mục tiêu không bị chậm.',
      keys: ['savings_capacity', 'savings_plan'],
      confidence: 'medium',
      limitations: ['Mức đề xuất dựa trên dòng tiền trung bình, không tính lạm phát.'],
    });
  }

  drafts.sort((left, right) => left.severity - right.severity || left.id.localeCompare(right.id));
  const selected: DraftedRecommendation[] =
    drafts.length > 0
      ? drafts.slice(0, 4)
      : [
          {
            id: 'maintain-habits',
            severity: 4,
            title: 'Duy trì thói quen hiện tại',
            detail:
              'Chưa thấy dấu hiệu bất thường trong dữ liệu đã ghi nhận. Tiếp tục ghi chép giao dịch ' +
              'đều đặn để phân tích chính xác hơn.',
            expectedImpact: 'Dữ liệu đầy đủ giúp các chỉ số và dự báo ổn định hơn.',
            keys: ['overview_income', 'overview_expense'],
            confidence: 'low',
            limitations: ['Chưa đủ dữ liệu để đề xuất hành động cụ thể.'],
          },
        ];

  const recommendations: AnalyticsAiRecommendationDto[] = selected.map((draft) => ({
    id: draft.id,
    title: draft.title,
    detail: draft.detail,
    evidence: analyticsEvidenceList(draft.keys, catalog),
    expectedImpact: draft.expectedImpact,
    confidence: draft.confidence,
    limitations: draft.limitations,
    requiresConfirmation: true,
  }));

  return { recommendations, referenceKeys: ['overview_net', 'overview_expense'] };
}

export function fallbackChatReply(
  context: AnalyticsAiContext,
  intent: AnalyticsAiChatIntent,
): { reply: string; referenceKeys: string[] } {
  switch (intent) {
    case 'SUMMARY':
      return {
        reply: fallbackSummary(context).summary,
        referenceKeys: ['overview_net', 'savings_rate'],
      };
    case 'EXPLAIN':
      return {
        reply: `${fallbackExplanation(context).summary} ${cashFlowSentence(context)}`,
        referenceKeys: ['overview_income', 'overview_expense', 'overview_net', 'savings_rate'],
      };
    case 'HEALTH':
      return { reply: healthSentence(context), referenceKeys: ['health_overall'] };
    case 'FORECAST':
      return {
        reply: forecastSentence(context),
        referenceKeys: ['forecast_net', 'forecast_balance'],
      };
    case 'BUDGET':
      return { reply: budgetSentence(context), referenceKeys: ['budgets_summary'] };
    case 'CATEGORY':
      return {
        reply: categorySentence(context),
        referenceKeys: ['overview_expense', 'category:1'],
      };
    case 'SAVINGS':
      return {
        reply: savingsSentence(context),
        referenceKeys: ['savings_capacity', 'savings_plan'],
      };
    case 'UNSUPPORTED':
      return {
        reply:
          'Mình chỉ tóm tắt, giải thích, gợi ý và trả lời câu hỏi dựa trên dữ liệu của bạn. ' +
          'Mình không thể tạo, sửa hay xóa giao dịch, ngân sách, mục tiêu hay số dư. ' +
          'Bạn hãy dùng màn hình tương ứng để thực hiện thay đổi.',
        referenceKeys: [],
      };
    default:
      return {
        reply:
          'Mình chưa rõ bạn muốn xem phần nào. Bạn có thể hỏi về dòng tiền trong kỳ, danh mục chi tiêu, ' +
          'ngân sách, dự báo tháng này hoặc điểm sức khỏe tài chính.',
        referenceKeys: [],
      };
  }
}
