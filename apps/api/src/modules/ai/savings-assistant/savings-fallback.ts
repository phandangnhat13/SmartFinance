import type {
  SavingsChatIntent,
  SavingsExplanationSectionDto,
  SavingsSimulationDto,
  SavingsSuggestionDto,
} from '@smart-finance/shared-types';
import {
  type SavingsAiContext,
  evidenceCatalog,
  evidenceList,
  formatAmount,
  formatDateDisplay,
} from './savings-context';

/**
 * Deterministic Vietnamese answer generator (M2e fallback).
 *
 * Used when no model is configured, when the provider fails or times out, and
 * when a model response fails validation. Everything here is derived from the
 * same structured context as the prompts, so the user always gets an answer
 * built from their real figures — never a fabricated one.
 */

const STATUS_LABELS: Record<string, string> = {
  ON_TRACK: 'đúng tiến độ',
  AT_RISK: 'chậm tiến độ',
  OVERDUE: 'quá hạn',
  COMPLETED: 'đã hoàn thành',
  PAUSED: 'đang tạm dừng',
  INSUFFICIENT_DATA: 'chưa đủ dữ liệu',
};

function capacitySentence(context: SavingsAiContext): string {
  const { currency, capacity } = context;
  if (capacity.status === 'available' && capacity.suggestedMonthlySaving !== null) {
    return (
      `Trong ${capacity.monthsAnalyzed} tháng đã kết thúc gần nhất, thu nhập trung bình là ` +
      `${formatAmount(capacity.averageMonthlyIncome, currency)} và chi tiêu trung bình là ` +
      `${formatAmount(capacity.averageMonthlyExpense, currency)}, nên dòng tiền ròng trung bình ` +
      `là ${formatAmount(capacity.averageNetCashFlow, currency)}. Hệ thống giữ lại ` +
      `${capacity.safetyBufferPercent}% (${formatAmount(capacity.safetyBufferAmount, currency)}) ` +
      `làm khoản dự phòng và đề xuất ${formatAmount(capacity.suggestedMonthlySaving, currency)}/tháng.`
    );
  }
  if (capacity.status === 'no_capacity') {
    return (
      `Dòng tiền ròng trung bình là ${formatAmount(capacity.averageNetCashFlow, currency)}, ` +
      'không dương, nên chưa thể đề xuất một mức tiết kiệm an toàn. Hệ thống không tạo ra một con số thay thế.'
    );
  }
  if (capacity.monthsAnalyzed === 0) {
    return (
      'Chưa có tháng nào đã kết thúc có giao dịch thu hoặc chi, nên chưa thể ước tính khả năng tiết kiệm. ' +
      'Tháng đang diễn ra không được tính vào mức trung bình.'
    );
  }
  return (
    'Chưa ghi nhận thu nhập trong các tháng đã phân tích, nên chưa có cơ sở để đề xuất mức tiết kiệm. ' +
    'Chi tiêu một mình không cho biết bạn có thể dành ra bao nhiêu.'
  );
}

export function fallbackExplanation(context: SavingsAiContext): {
  summary: string;
  sections: SavingsExplanationSectionDto[];
} {
  const { currency } = context;
  const top = context.goals.filter((goal) => goal.priority !== null).slice(0, 3);
  const atRisk = context.goals.filter(
    (goal) => goal.progressStatus === 'AT_RISK' || goal.progressStatus === 'OVERDUE',
  );

  const summary =
    context.plan.monthlyBudget === null
      ? 'Chưa đủ dữ liệu để lập kế hoạch tiết kiệm tháng này. Bạn vẫn xem được tiến độ từng mục tiêu.'
      : `Kế hoạch tháng này phân bổ ${formatAmount(context.plan.allocatedMonthly, currency)} trên ` +
        `${context.progress.activeGoals} mục tiêu đang thực hiện, dựa trên dòng tiền đã ghi nhận.`;

  const priorityBody =
    top.length === 0
      ? 'Chưa có mục tiêu nào đang thực hiện trong loại tiền tệ này.'
      : top
          .map(
            (goal) =>
              `${goal.priority}. ${goal.goalName}: ${goal.priorityReason} ${
                goal.recommendedMonthlySaving === null
                  ? 'Chưa có mức phân bổ.'
                  : `Phân bổ ${formatAmount(goal.recommendedMonthlySaving, currency)}/tháng.`
              }`,
          )
          .join(' ');

  const riskBody =
    atRisk.length === 0
      ? 'Không có mục tiêu nào đang chậm tiến độ hoặc quá hạn tại thời điểm này.'
      : atRisk
          .slice(0, 3)
          .map(
            (goal) =>
              `${goal.goalName}: ${STATUS_LABELS[goal.progressStatus] ?? goal.progressStatus} — ${goal.statusReason}`,
          )
          .join(' ');

  return {
    summary,
    sections: [
      { title: 'Khả năng tiết kiệm', body: capacitySentence(context) },
      {
        title: `Vì sao giữ lại ${context.capacity.safetyBufferPercent}%`,
        body:
          `Khoản dự phòng ${context.capacity.safetyBufferPercent}% là quy tắc cố định của hệ thống, ` +
          'không phải do AI tính. Nó chừa chỗ cho chi phí bất ngờ để kế hoạch không buộc bạn phải ' +
          'rút tiền khỏi mục tiêu ngay tháng sau.',
      },
      { title: 'Mục tiêu ưu tiên', body: priorityBody },
      { title: 'Rủi ro và tiến độ', body: riskBody },
    ],
  };
}

export function fallbackSuggestions(context: SavingsAiContext): SavingsSuggestionDto[] {
  const catalog = evidenceCatalog(context);
  const { currency } = context;
  const suggestions: SavingsSuggestionDto[] = [];

  if (
    context.capacity.status === 'available' &&
    context.plan.unallocatedMonthly !== null &&
    Number(context.plan.unallocatedMonthly) > 0
  ) {
    const firstGoals = context.goals.filter((goal) => goal.priority !== null).slice(0, 3);
    suggestions.push({
      id: 'unallocated-budget',
      title: 'Phân bổ phần ngân sách còn lại',
      explanation:
        `Sau khi phân bổ cho các mục tiêu, kế hoạch còn ${formatAmount(context.plan.unallocatedMonthly, currency)} ` +
        'chưa dùng. Bạn có thể dành phần này cho mục tiêu ưu tiên hoặc giữ nguyên làm khoản dự phòng.',
      evidence: evidenceList(['unallocated', 'monthly_budget'], catalog),
      expectedImpact:
        'Mục tiêu ưu tiên sẽ nhận thêm tiền góp nếu bạn tự điều chỉnh khoản góp; hệ thống không tự áp dụng.',
      goalIds: firstGoals.slice(0, 1).map((goal) => goal.goalId),
      confidence: context.capacity.confidence,
      limitations: [
        'Đây là gợi ý, không phải khoản góp đã ghi nhận.',
        'Phần còn lại có thể cần cho chi phí bất ngờ trong tháng.',
      ],
      requiresConfirmation: true,
    });
  }

  const atRisk = context.goals.filter(
    (goal) =>
      (goal.progressStatus === 'AT_RISK' || goal.progressStatus === 'OVERDUE') &&
      goal.requiredMonthlySaving !== null,
  );
  atRisk.slice(0, 2).forEach((goal) => {
    suggestions.push({
      id: `catch-up-${goal.goalId}`,
      title: `Đưa mục tiêu ${goal.goalName} về đúng kế hoạch`,
      explanation:
        `${goal.goalName} đang ${STATUS_LABELS[goal.progressStatus] ?? goal.progressStatus}: ${goal.statusReason} ` +
        `Mức cần thiết để hoàn thành trước ${formatDateDisplay(goal.targetDate)} là ` +
        `${formatAmount(goal.requiredMonthlySaving, currency)}/tháng.`,
      evidence: evidenceList([`progress:${goal.goalId}`, `goal:${goal.goalId}`], catalog),
      expectedImpact:
        'Nếu bạn góp đủ mức cần thiết mỗi tháng, mục tiêu có thể hoàn thành đúng hạn; đây là ước tính, không phải cam kết.',
      goalIds: [goal.goalId],
      confidence: context.capacity.confidence,
      limitations: ['Chưa tính lãi suất, lạm phát hay các nghĩa vụ sắp tới.'],
      requiresConfirmation: true,
    });
  });

  if (suggestions.length === 0) {
    suggestions.push({
      id: 'maintain-plan',
      title: 'Duy trì mức góp hiện tại',
      explanation:
        context.plan.monthlyBudget === null
          ? 'Bổ sung dữ liệu thu nhập và chi tiêu để hệ thống có thể đề xuất mức tiết kiệm.'
          : `Các mục tiêu đang theo đúng kế hoạch với tổng mức góp ${formatAmount(context.plan.allocatedMonthly, currency)}/tháng.`,
      evidence: evidenceList(['capacity', 'monthly_budget'], catalog),
      expectedImpact: 'Giữ nguyên nhịp góp hiện tại để không làm gián đoạn kế hoạch.',
      goalIds: [],
      confidence: context.capacity.confidence,
      limitations: ['Cần cập nhật giao dịch đều đặn để mức trung bình phản ánh đúng.'],
      requiresConfirmation: false,
    });
  }

  if (context.capacity.confidence === 'low') {
    suggestions.forEach((suggestion) => {
      suggestion.limitations = [
        ...suggestion.limitations,
        'Dữ liệu ít hơn 3 tháng nên độ tin cậy thấp.',
      ];
    });
  }
  return suggestions;
}

export function fallbackChatReply(
  context: SavingsAiContext,
  intent: SavingsChatIntent,
): { reply: string; referenceKeys: string[] } {
  const { currency } = context;
  switch (intent) {
    case 'STATUS': {
      const summary = context.progress;
      const atRisk = context.goals.filter(
        (goal) => goal.progressStatus === 'AT_RISK' || goal.progressStatus === 'OVERDUE',
      );
      return {
        reply:
          `Bạn đang có ${summary.activeGoals} mục tiêu trong ${currency}: ${summary.onTrack} đúng tiến độ, ` +
          `${summary.atRisk} chậm tiến độ, ${summary.overdue} quá hạn. Tổng đã tiết kiệm ` +
          `${formatAmount(summary.totalSavedAmount, currency)} trên ${formatAmount(summary.totalTargetAmount, currency)}.` +
          (atRisk.length > 0
            ? ` Cần chú ý: ${atRisk.map((goal) => goal.goalName).join(', ')}.`
            : ''),
        referenceKeys: ['capacity', 'monthly_budget'],
      };
    }
    case 'PRIORITY': {
      const ranked = context.goals.filter((goal) => goal.priority !== null).slice(0, 3);
      return {
        reply:
          ranked.length === 0
            ? 'Chưa có mục tiêu nào được phân bổ trong kế hoạch tháng này.'
            : `Thứ tự ưu tiên hiện tại: ${ranked
                .map((goal) => `${goal.priority}. ${goal.goalName} (${goal.priorityReason})`)
                .join(' ')} Thứ tự này dựa trên hạn chót, không dựa trên số tiền.`,
        referenceKeys: ranked.map((goal) => `goal:${goal.goalId}`).slice(0, 3),
      };
    }
    case 'EXPLAIN': {
      const { summary } = fallbackExplanation(context);
      return {
        reply: `${summary} ${capacitySentence(context)}`,
        referenceKeys: ['capacity', 'income', 'expense', 'safety_buffer'],
      };
    }
    case 'UNSUPPORTED':
      return {
        reply:
          'Mình chỉ giải thích, gợi ý và mô phỏng dựa trên dữ liệu của bạn. Mình không thể tạo, sửa hay xóa mục tiêu, ' +
          'khoản góp, giao dịch hoặc số dư. Bạn dùng màn hình Mục tiêu tiết kiệm để thực hiện các thay đổi đó.',
        referenceKeys: [],
      };
    case 'SCENARIO':
      return {
        reply:
          'Mình đã hiểu đây là một kịch bản. Kết quả mô phỏng bên dưới do hệ thống tính, không phải AI, và không có thay đổi nào được lưu.',
        referenceKeys: ['capacity', 'monthly_budget'],
      };
    default:
      return {
        reply:
          'Mình có thể giải thích mức tiết kiệm đề xuất, tình trạng tiến độ, thứ tự ưu tiên, hoặc mô phỏng một kịch bản ' +
          'như “Nếu góp 2.000.000 ₫ mỗi tháng cho mục tiêu Du lịch thì sao?”.',
        referenceKeys: [],
      };
  }
}

export function fallbackScenarioExplanation(simulation: SavingsSimulationDto): string {
  if (simulation.scenario === 'MULTI_GOAL_BUDGET') {
    const infeasible = simulation.simulated.items.filter(
      (item) => item.feasibility === 'NOT_FEASIBLE',
    );
    return (
      `Đây là mô phỏng chỉ đọc: không có khoản góp hay thay đổi mục tiêu nào được lưu. ` +
      `Với ngân sách ${formatAmount(simulation.budget, simulation.currency)}/tháng, hệ thống phân bổ ` +
      `${formatAmount(simulation.simulated.allocatedMonthly, simulation.currency)}` +
      (simulation.simulated.unallocatedMonthly !== null
        ? `, còn lại ${formatAmount(simulation.simulated.unallocatedMonthly, simulation.currency)} chưa phân bổ`
        : '') +
      (infeasible.length > 0
        ? `. Chưa đủ ngân sách cho: ${infeasible.map((item) => item.goalName).join(', ')}.`
        : '. Tất cả mục tiêu đang thực hiện đều nhận được phân bổ.')
    );
  }

  const simulated = simulation.simulated;
  const current = simulation.current;
  const completion = simulated.estimatedCompletionDate
    ? `dự kiến hoàn thành ${formatDateDisplay(simulated.estimatedCompletionDate)}`
    : 'chưa đủ dữ liệu để dự kiến ngày hoàn thành';
  const deadline =
    simulated.targetDate === null
      ? 'mục tiêu không có ngày đích'
      : simulated.deadlineMet === null
        ? `hạn hiện tại ${formatDateDisplay(simulated.targetDate)}`
        : simulated.deadlineMet
          ? `trước hạn ${formatDateDisplay(simulated.targetDate)}`
          : `sau hạn ${formatDateDisplay(simulated.targetDate)}`;

  return (
    `Đây là mô phỏng chỉ đọc, không phải thay đổi đã lưu. Với giả định này, mục tiêu ${simulation.goalName} ` +
    `còn thiếu ${formatAmount(simulated.remainingAmount, simulation.currency)}, ${completion} (${deadline}). ` +
    `${simulation.feasibilityReason} ` +
    `Hiện tại mục tiêu còn thiếu ${formatAmount(current.remainingAmount, simulation.currency)}.`
  );
}
