import { BadRequestException } from '@nestjs/common';
import type {
  GoalProgressDto,
  SavingsProgressDto,
  SavingsRecommendationsDto,
  SavingsSimulationDto,
} from '@smart-finance/shared-types';
import { SavingsRecommendationService } from '../../insights/savings-recommendation.service';
import { SavingsPlanService } from '../../savings/savings-plan.service';
import { SavingsProgressService } from '../../savings/savings-progress.service';
import { LlmUnavailableError, type LlmProvider } from '../llm/llm.types';
import { SavingsAssistantService } from './savings-assistant.service';

const USER = 'user-1';

function goalProgress(overrides: Partial<GoalProgressDto> = {}): GoalProgressDto {
  return {
    goalId: 'g1',
    name: 'Du lịch',
    currency: 'VND',
    status: 'ACTIVE',
    displayStatus: 'ACTIVE',
    targetAmount: '24000000.00',
    savedAmount: '5000000.00',
    remainingAmount: '19000000.00',
    completionPercentage: 21,
    startDate: '2026-01-01',
    targetDate: '2027-06-30',
    monthsRemaining: 8,
    requiredMonthlySaving: '2375000.00',
    expectedAmount: '15000000.00',
    expectedPercentage: 62.5,
    actualVsExpected: '-10000000.00',
    atRisk: true,
    aheadOfSchedule: false,
    pace: {
      monthsObserved: 10,
      averageMonthlyContribution: '500000.00',
      monthsToComplete: 38,
      estimatedCompletionDate: '2028-12-31',
      projectedAmountAtDeadline: '9000000.00',
      projectedHitsDeadline: false,
    },
    progressStatus: 'AT_RISK',
    statusReason: 'Chậm hơn kế hoạch.',
    lastContributionAt: '2026-10-01T00:00:00.000Z',
    timeline: [],
    ...overrides,
  };
}

function progressDto(overrides: Partial<SavingsProgressDto> = {}): SavingsProgressDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    today: '2026-10-30',
    generatedAt: '2026-10-30T03:00:00.000Z',
    asOf: '2026-10-30',
    summary: {
      currency: 'VND',
      activeGoals: 1,
      onTrack: 0,
      atRisk: 1,
      overdue: 0,
      completed: 0,
      paused: 0,
      insufficientData: 0,
      totalTargetAmount: '24000000.00',
      totalSavedAmount: '5000000.00',
      totalRemainingAmount: '19000000.00',
      overallPercentage: 21,
    },
    goals: [goalProgress()],
    excluded: { archived: 0 },
    rules: ['Mục tiêu quá hạn được xếp trước.'],
    limitations: ['Chỉ tính một loại tiền tệ.'],
    ...overrides,
  };
}

function recommendationsDto(
  overrides: Partial<SavingsRecommendationsDto> = {},
): SavingsRecommendationsDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    generatedAt: '2026-10-30T03:00:00.000Z',
    status: 'available',
    capacity: {
      status: 'available',
      reason: null,
      currency: 'VND',
      monthsAnalyzed: 6,
      analyzedMonths: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
      averageMonthlyIncome: '20000000.00',
      averageMonthlyExpense: '15000000.00',
      averageNetCashFlow: '5000000.00',
      historicalSavingsRate: 25,
      safetyBufferPercent: 20,
      safetyBufferAmount: '1000000.00',
      suggestedMonthlySaving: '4000000.00',
      isPositive: true,
      confidence: 'high',
    },
    monthlyBudget: '4000000.00',
    simulated: false,
    simulatedMonthlySaving: null,
    items: [
      {
        goalId: 'g1',
        goalName: 'Du lịch',
        currency: 'VND',
        displayStatus: 'ACTIVE',
        targetDate: '2027-06-30',
        monthsRemaining: 8,
        remainingAmount: '19000000.00',
        requiredMonthlySaving: '2375000.00',
        recommendedMonthlySaving: '2375000.00',
        estimatedCompletionDate: '2027-06-30',
        feasibility: 'ON_TRACK',
        priority: 1,
        priorityReason: 'Hạn chót 2027-06-30.',
        explanation: 'Đề xuất 2.375.000 VND/tháng.',
      },
    ],
    allocatedMonthly: '2375000.00',
    unallocatedMonthly: '1625000.00',
    excluded: { paused: 0, completed: 0, archived: 0 },
    assumptions: ['Chỉ phân tích một loại tiền tệ.'],
    limitations: ['Chưa tính lạm phát.'],
    ...overrides,
  };
}

/** Two active goals, so a scenario without a goal name is genuinely ambiguous. */
function twoActiveGoals(): SavingsProgressDto {
  return progressDto({
    goals: [
      goalProgress(),
      goalProgress({
        goalId: 'g2',
        name: 'Mua laptop',
        targetAmount: '30000000.00',
        remainingAmount: '25000000.00',
      }),
    ],
  });
}

const SIMULATION: SavingsSimulationDto = {
  scenario: 'MONTHLY_AMOUNT',
  currency: 'VND',
  timezone: 'Asia/Ho_Chi_Minh',
  generatedAt: '2026-10-30T03:00:00.000Z',
  goalId: 'g1',
  goalName: 'Du lịch',
  current: {
    targetAmount: '24000000.00',
    savedAmount: '5000000.00',
    remainingAmount: '19000000.00',
    completionPercentage: 21,
    targetDate: '2027-06-30',
    monthsRemaining: 8,
    requiredMonthlySaving: '2375000.00',
    monthlySaving: '2375000.00',
    monthsToComplete: 8,
    estimatedCompletionDate: '2027-06-30',
    deadlineMet: true,
  },
  simulated: {
    targetAmount: '24000000.00',
    savedAmount: '5000000.00',
    remainingAmount: '19000000.00',
    completionPercentage: 21,
    targetDate: '2027-06-30',
    monthsRemaining: 8,
    requiredMonthlySaving: '2375000.00',
    monthlySaving: '3000000.00',
    monthsToComplete: 7,
    estimatedCompletionDate: '2027-05-30',
    deadlineMet: true,
  },
  difference: {
    targetAmount: '0',
    remainingAmount: '0',
    requiredMonthlySaving: '2375000.00',
    monthlySaving: '625000.00',
    completionDateShiftMonths: -1,
  },
  capacity: { available: true, monthlySaving: '4000000.00', requiredWithinCapacity: true },
  feasibility: 'FEASIBLE',
  feasibilityReason: 'Mức góp nằm trong khả năng tiết kiệm.',
  warnings: [],
  limitations: ['Chỉ là mô phỏng.'],
};

function makeLlm(options: { enabled: boolean; reply?: string; error?: Error }) {
  return {
    name: 'anthropic',
    model: 'claude-opus-5-5',
    enabled: options.enabled,
    complete: jest.fn(async (_request: { system: string; user: string; maxTokens?: number }) => {
      if (options.error) throw options.error;
      return { text: options.reply ?? '{}', model: 'claude-opus-5-5' };
    }),
  } satisfies LlmProvider;
}

function makeService(llm: LlmProvider) {
  const recommendations = {
    recommend: jest.fn(async (_userId: string, query: { currency?: string }) =>
      recommendationsDto({ currency: query.currency ?? 'VND' }),
    ),
  };
  const progress = {
    progress: jest.fn(async (_userId: string, _query: { currency?: string }) => progressDto()),
  };
  const plans = {
    simulate: jest.fn(async (_userId: string, _input: unknown) => SIMULATION),
    applyAdjustment: jest.fn(),
  };
  const service = new SavingsAssistantService(
    recommendations as unknown as SavingsRecommendationService,
    progress as unknown as SavingsProgressService,
    plans as unknown as SavingsPlanService,
    llm,
  );
  return { service, recommendations, progress, plans };
}

const VALID_EXPLANATION = JSON.stringify({
  summary: 'Kế hoạch tháng này giữ lại 20% dòng tiền ròng.',
  sections: [
    { title: 'Khả năng tiết kiệm', body: 'Dòng tiền ròng 5.000.000 VND trong 6 tháng.' },
    { title: 'Dự phòng', body: 'Giữ lại 1.000.000 VND.' },
    { title: 'Ưu tiên', body: 'Du lịch đứng đầu danh sách.' },
  ],
});

describe('SavingsAssistantService', () => {
  describe('explain', () => {
    it('uses the deterministic fallback when AI is disabled and still returns backend facts', async () => {
      const { service, plans } = makeService(makeLlm({ enabled: false }));

      const result = await service.explain(USER, {});

      expect(result.source).toBe('FALLBACK');
      expect(result.disclosure.fallbackReason).toBe('disabled');
      expect(result.disclosure.usedModel).toBe(false);
      expect(result.facts.monthlyBudget).toBe('4000000.00');
      expect(result.facts.safetyBufferPercent).toBe(20);
      expect(result.goals[0]).toMatchObject({ goalId: 'g1', progressStatus: 'AT_RISK' });
      expect(result.sections).toHaveLength(4);
      expect(plans.simulate).not.toHaveBeenCalled();
    });

    it('returns validated model text and discloses what was sent', async () => {
      const llm = makeLlm({ enabled: true, reply: VALID_EXPLANATION });
      const { service } = makeService(llm);

      const result = await service.explain(USER, {});

      expect(result.source).toBe('AI');
      expect(result.disclosure).toMatchObject({ usedModel: true, provider: 'anthropic' });
      expect(result.summary).toContain('20%');
      const prompt = llm.complete.mock.calls[0][0] as { system: string; user: string };
      expect(prompt.user).not.toContain(USER);
      expect(prompt.user).toContain('4000000.00');
    });

    it('discards a model answer that invents a figure', async () => {
      const invented = VALID_EXPLANATION.replace('5.000.000 VND', '9.000.000 VND');
      const { service } = makeService(makeLlm({ enabled: true, reply: invented }));

      const result = await service.explain(USER, {});

      expect(result.source).toBe('FALLBACK');
      expect(result.disclosure.fallbackReason).toBe('invalid_response');
    });

    it.each([
      ['timeout', new LlmUnavailableError('timeout', 'slow'), 'timeout'],
      ['rate_limited', new LlmUnavailableError('rate_limited', 'busy'), 'rate_limited'],
      ['provider_error', new LlmUnavailableError('provider_error', 'down'), 'provider_error'],
      ['unexpected', new Error('boom'), 'provider_error'],
    ])(
      'falls back with the right reason when the provider fails (%s)',
      async (_label, error, reason) => {
        const { service } = makeService(makeLlm({ enabled: true, error }));

        const result = await service.explain(USER, {});

        expect(result.source).toBe('FALLBACK');
        expect(result.disclosure.fallbackReason).toBe(reason);
      },
    );

    it('passes the requested currency to M2c and reuses it for M2d', async () => {
      const { service, recommendations, progress } = makeService(makeLlm({ enabled: false }));

      await service.explain(USER, { currency: 'USD' });

      expect(recommendations.recommend).toHaveBeenCalledWith(USER, { currency: 'USD' });
      expect(progress.progress).toHaveBeenCalledWith(USER, { currency: 'USD' });
    });
  });

  describe('suggestions', () => {
    const reply = JSON.stringify({
      suggestions: [
        {
          title: 'Tăng mức góp cho Du lịch',
          explanation: 'Mục tiêu đang chậm tiến độ so với kế hoạch.',
          expectedImpact: 'Có thể hoàn thành đúng hạn nếu giữ nhịp.',
          evidenceKeys: ['goal:g1', 'progress:g1'],
          confidence: 'high',
          limitations: ['Chưa tính lạm phát.'],
        },
      ],
    });

    it('attaches backend-built evidence and requires confirmation', async () => {
      const { service } = makeService(makeLlm({ enabled: true, reply }));

      const result = await service.suggestions(USER, {});

      expect(result.source).toBe('AI');
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].goalIds).toEqual(['g1']);
      expect(result.suggestions[0].evidence[0].value).toContain('19.000.000 VND');
      expect(result.suggestions[0].requiresConfirmation).toBe(true);
    });

    it('falls back when a suggestion cites evidence the backend never offered', async () => {
      const bad = reply.replace('"goal:g1"', '"goal:ghost"');
      const { service } = makeService(makeLlm({ enabled: true, reply: bad }));

      const result = await service.suggestions(USER, {});

      expect(result.source).toBe('FALLBACK');
      expect(result.disclosure.fallbackReason).toBe('invalid_response');
    });

    it('builds fallback suggestions with evidence when AI is disabled', async () => {
      const { service } = makeService(makeLlm({ enabled: false }));

      const result = await service.suggestions(USER, {});

      expect(result.source).toBe('FALLBACK');
      expect(result.suggestions.length).toBeGreaterThan(0);
      result.suggestions.forEach((suggestion) => {
        expect(suggestion.evidence.length).toBeGreaterThan(0);
      });
    });
  });

  describe('scenarioExplanation', () => {
    it('runs the parsed scenario through M2d with exact arguments and never applies it', async () => {
      const { service, plans } = makeService(makeLlm({ enabled: false }));

      const result = await service.scenarioExplanation(USER, {
        message: 'Nếu tôi góp 3.000.000 mỗi tháng cho mục tiêu Du lịch thì sao?',
      });

      expect(plans.simulate).toHaveBeenCalledWith(USER, {
        scenario: 'MONTHLY_AMOUNT',
        goalId: 'g1',
        monthlyAmount: '3000000',
      });
      expect(plans.applyAdjustment).not.toHaveBeenCalled();
      expect(result.status).toBe('simulated');
      expect(result.simulation).toEqual(SIMULATION);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.source).toBe('FALLBACK');
      expect(result.explanation).toContain('mô phỏng');
    });

    it('asks for clarification instead of guessing when the goal is ambiguous', async () => {
      const { service, plans, progress } = makeService(makeLlm({ enabled: false }));
      progress.progress.mockResolvedValueOnce(twoActiveGoals());

      const result = await service.scenarioExplanation(USER, {
        message: 'Nếu góp 2.000.000 mỗi tháng thì sao?',
      });

      expect(result.status).toBe('clarification');
      expect(result.simulation).toBeNull();
      expect(result.clarification).toContain('mục tiêu nào');
      expect(plans.simulate).not.toHaveBeenCalled();
    });

    it('turns a rejected simulation into a clarification, not an error', async () => {
      const llm = makeLlm({ enabled: false });
      const { service, plans } = makeService(llm);
      plans.simulate.mockRejectedValueOnce(new BadRequestException('Số tiền phải lớn hơn 0'));

      const result = await service.scenarioExplanation(USER, {
        message: 'Nếu tôi góp 3.000.000 mỗi tháng cho mục tiêu Du lịch thì sao?',
      });

      expect(result.status).toBe('clarification');
      expect(result.explanation).toContain('lớn hơn 0');
      expect(result.simulation).toBeNull();
    });

    it('keeps the deterministic simulation even when the model reply is invalid', async () => {
      const { service } = makeService(
        makeLlm({ enabled: true, reply: '{"reply":"Bạn sẽ có 9.999.000 VND."}' }),
      );

      const result = await service.scenarioExplanation(USER, {
        message: 'Nếu tôi góp 3.000.000 mỗi tháng cho mục tiêu Du lịch thì sao?',
      });

      expect(result.status).toBe('simulated');
      expect(result.simulation).toEqual(SIMULATION);
      expect(result.source).toBe('FALLBACK');
      expect(result.disclosure.fallbackReason).toBe('invalid_response');
    });
  });

  describe('chat', () => {
    it('refuses data-changing requests without calling the model', async () => {
      const llm = makeLlm({ enabled: true, reply: '{"reply":"ok"}' });
      const { service, plans } = makeService(llm);

      const result = await service.chat(USER, { message: 'Xóa mục tiêu Du lịch giúp mình' });

      expect(result.intent).toBe('UNSUPPORTED');
      expect(result.canModifyData).toBe(false);
      expect(result.clarification).toContain('không thể tạo, sửa hay xóa');
      expect(llm.complete).not.toHaveBeenCalled();
      expect(plans.simulate).not.toHaveBeenCalled();
      expect(plans.applyAdjustment).not.toHaveBeenCalled();
    });

    it('answers a status question from the fallback when AI is disabled', async () => {
      const { service } = makeService(makeLlm({ enabled: false }));

      const result = await service.chat(USER, { message: 'Tiến độ các mục tiêu thế nào?' });

      expect(result.intent).toBe('STATUS');
      expect(result.source).toBe('FALLBACK');
      expect(result.reply).toContain('24.000.000 VND');
      expect(result.references.length).toBeGreaterThan(0);
    });

    it('returns a validated model answer with backend references', async () => {
      const llm = makeLlm({
        enabled: true,
        reply: JSON.stringify({
          reply: 'Mục tiêu đang chậm tiến độ so với kế hoạch.',
          referenceKeys: ['progress:g1'],
        }),
      });
      const { service } = makeService(llm);

      const result = await service.chat(USER, {
        message: 'Tại sao mục tiêu Du lịch lại chậm?',
        history: [{ role: 'user', content: 'Chào bạn' }],
      });

      expect(result.intent).toBe('EXPLAIN');
      expect(result.source).toBe('AI');
      expect(result.references[0].label).toContain('Tiến độ');
      expect(result.disclosure.usedModel).toBe(true);
    });

    it('falls back when the model invents a number', async () => {
      const { service } = makeService(
        makeLlm({ enabled: true, reply: '{"reply":"Bạn đang có 9.999.000 VND."}' }),
      );

      const result = await service.chat(USER, { message: 'Tại sao mục tiêu Du lịch lại chậm?' });

      expect(result.source).toBe('FALLBACK');
      expect(result.disclosure.fallbackReason).toBe('invalid_response');
    });

    it('answers a scenario message with the deterministic simulation', async () => {
      const { service, plans } = makeService(makeLlm({ enabled: false }));

      const result = await service.chat(USER, {
        message: 'Nếu tôi góp 3.000.000 mỗi tháng cho mục tiêu Du lịch thì sao?',
      });

      expect(result.intent).toBe('SCENARIO');
      expect(result.scenario).toEqual(SIMULATION);
      expect(result.references.map((reference) => reference.label)).toContain(
        'Mức tiết kiệm đề xuất mỗi tháng',
      );
      expect(plans.simulate).toHaveBeenCalledTimes(1);
    });

    it('asks a clarifying question when the scenario lacks a goal', async () => {
      const { service, plans, progress } = makeService(makeLlm({ enabled: false }));
      progress.progress.mockResolvedValueOnce(twoActiveGoals());

      const result = await service.chat(USER, { message: 'Nếu góp 2.000.000 mỗi tháng thì sao?' });

      expect(result.intent).toBe('SCENARIO');
      expect(result.scenario).toBeNull();
      expect(result.clarification).toContain('mục tiêu nào');
      expect(plans.simulate).not.toHaveBeenCalled();
    });
  });
});
