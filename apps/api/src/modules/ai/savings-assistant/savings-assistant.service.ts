import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type {
  AiDisclosureDto,
  AiFallbackReason,
  SavingsChatIntent,
  SavingsChatReplyDto,
  SavingsExplanationDto,
  SavingsExplanationGoalDto,
  SavingsScenarioExplanationDto,
  SavingsSimulationDto,
  SavingsSuggestionDto,
  SavingsSuggestionsDto,
} from '@smart-finance/shared-types';
import { SavingsRecommendationService } from '../../insights/savings-recommendation.service';
import { SavingsPlanService } from '../../savings/savings-plan.service';
import { SavingsProgressService } from '../../savings/savings-progress.service';
import {
  LlmInvalidResponseError,
  LlmUnavailableError,
  LLM_PROVIDER,
  type LlmProvider,
} from '../llm/llm.types';
import type {
  SavingsChatRequestDto,
  SavingsExplainRequestDto,
  SavingsScenarioRequestDto,
  SavingsSuggestionsRequestDto,
} from './dto/savings-assistant.dto';
import {
  buildChatPrompt,
  buildExplanationPrompt,
  buildScenarioExplanationPrompt,
  buildSuggestionsPrompt,
  parseChatReply,
  parseExplanation,
  parseSuggestions,
} from './savings-ai-output';
import {
  buildSavingsAiContext,
  collectAllowedNumbers,
  evidenceCatalog,
  evidenceList,
  type SavingsAiContext,
} from './savings-context';
import {
  fallbackChatReply,
  fallbackExplanation,
  fallbackScenarioExplanation,
  fallbackSuggestions,
} from './savings-fallback';
import { interpretScenario, normalizeText, type ScenarioInterpretation } from './savings-intent';

const DATA_NOTICE =
  'Mình không thể tạo, sửa hay xóa mục tiêu, khoản góp, giao dịch hoặc số dư. Bạn hãy dùng màn hình tương ứng để thực hiện thay đổi.';

const UNSUPPORTED_PATTERN =
  /(tao|xoa|sua|them|cap nhat|chuyen|thanh toan|doi mat khau)\s+(muc tieu|khoan gop|giao dich|so du|tai khoan|mat khau)/;

/**
 * AI savings assistant (M2e).
 *
 * The deterministic backend remains the only source of financial values:
 * M2c provides capacity and allocation, M2d provides progress and simulations.
 * The model receives that structured context and returns prose plus a selection
 * of backend-built evidence keys. A response that fails validation, times out,
 * or invents a number is discarded and replaced by `savings-fallback.ts`.
 */
@Injectable()
export class SavingsAssistantService {
  constructor(
    private readonly recommendations: SavingsRecommendationService,
    private readonly progress: SavingsProgressService,
    private readonly plans: SavingsPlanService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  async explain(userId: string, dto: SavingsExplainRequestDto): Promise<SavingsExplanationDto> {
    const context = await this.loadContext(userId, dto.currency);
    const catalog = evidenceCatalog(context);
    const allowed = collectAllowedNumbers(context);
    const base = {
      currency: context.currency,
      timezone: context.timezone,
      today: context.today,
      generatedAt: new Date().toISOString(),
      facts: {
        currency: context.currency,
        capacityStatus: context.capacity.status,
        capacityReason: context.capacity.reason,
        monthsAnalyzed: context.capacity.monthsAnalyzed,
        analyzedMonths: context.capacity.analyzedMonths,
        averageMonthlyIncome: context.capacity.averageMonthlyIncome,
        averageMonthlyExpense: context.capacity.averageMonthlyExpense,
        averageNetCashFlow: context.capacity.averageNetCashFlow,
        historicalSavingsRate: context.capacity.historicalSavingsRate,
        safetyBufferPercent: context.capacity.safetyBufferPercent,
        safetyBufferAmount: context.capacity.safetyBufferAmount,
        monthlyBudget: context.plan.monthlyBudget,
        allocatedMonthly: context.plan.allocatedMonthly,
        unallocatedMonthly: context.plan.unallocatedMonthly,
        confidence: context.capacity.confidence,
      },
      goals: context.goals.map(toExplanationGoal),
      limitations: context.limitations.slice(0, 8),
    };

    const fallback = fallbackExplanation(context);
    if (!this.llm.enabled) {
      return {
        ...base,
        source: 'FALLBACK',
        ...fallback,
        disclosure: this.disclosure('disabled', false),
      };
    }

    const prompt = buildExplanationPrompt(context, Object.keys(catalog));
    try {
      const result = await this.llm.complete({ ...prompt, maxTokens: 1_600 });
      const parsed = parseExplanation(result.text, allowed);
      return {
        ...base,
        source: 'AI',
        ...parsed,
        disclosure: this.disclosure(null, true),
      };
    } catch (error) {
      return {
        ...base,
        source: 'FALLBACK',
        ...fallback,
        disclosure: this.disclosure(reasonFor(error), false),
      };
    }
  }

  async suggestions(
    userId: string,
    dto: SavingsSuggestionsRequestDto,
  ): Promise<SavingsSuggestionsDto> {
    const context = await this.loadContext(userId, dto.currency);
    const catalog = evidenceCatalog(context);
    const allowed = collectAllowedNumbers(context);
    const base = {
      currency: context.currency,
      timezone: context.timezone,
      generatedAt: new Date().toISOString(),
      limitations: context.limitations.slice(0, 8),
    };

    const fallback = fallbackSuggestions(context);
    if (!this.llm.enabled) {
      return {
        ...base,
        source: 'FALLBACK',
        suggestions: fallback,
        disclosure: this.disclosure('disabled', false),
      };
    }

    const prompt = buildSuggestionsPrompt(context, Object.keys(catalog));
    try {
      const result = await this.llm.complete({ ...prompt, maxTokens: 1_600 });
      const parsed = parseSuggestions(result.text, allowed, new Set(Object.keys(catalog)));
      const suggestions: SavingsSuggestionDto[] = parsed.map((item, index) => ({
        id: `ai-${index + 1}`,
        title: item.title,
        explanation: item.explanation,
        expectedImpact: item.expectedImpact,
        evidence: evidenceList(item.evidenceKeys, catalog),
        goalIds: item.evidenceKeys
          .filter((key) => key.startsWith('goal:'))
          .map((key) => key.slice('goal:'.length)),
        confidence: item.confidence,
        limitations: item.limitations,
        requiresConfirmation: true,
      }));
      return {
        ...base,
        source: 'AI',
        suggestions,
        disclosure: this.disclosure(null, true),
      };
    } catch (error) {
      return {
        ...base,
        source: 'FALLBACK',
        suggestions: fallback,
        disclosure: this.disclosure(reasonFor(error), false),
      };
    }
  }

  async scenarioExplanation(
    userId: string,
    dto: SavingsScenarioRequestDto,
  ): Promise<SavingsScenarioExplanationDto> {
    const context = await this.loadContext(userId, dto.currency);
    const interpretation = interpretScenario(
      dto.message,
      context.goals.map((goal) => ({
        id: goal.goalId,
        name: goal.goalName,
        status: scenarioGoalStatus(goal.progressStatus),
      })),
      context.today,
    );
    return this.runScenario(userId, context, interpretation, dto.message);
  }

  async chat(userId: string, dto: SavingsChatRequestDto): Promise<SavingsChatReplyDto> {
    const context = await this.loadContext(userId, dto.currency);
    const catalog = evidenceCatalog(context);
    const allowed = collectAllowedNumbers(context);
    const history = dto.history ?? [];
    const base = {
      currency: context.currency,
      timezone: context.timezone,
      generatedAt: new Date().toISOString(),
      canModifyData: false as const,
    };

    if (UNSUPPORTED_PATTERN.test(normalizeText(dto.message))) {
      const fallback = fallbackChatReply(context, 'UNSUPPORTED');
      return {
        ...base,
        source: 'FALLBACK',
        intent: 'UNSUPPORTED',
        reply: fallback.reply,
        references: [],
        scenario: null,
        clarification: DATA_NOTICE,
        disclosure: this.disclosure(
          null,
          false,
          'Yêu cầu thay đổi dữ liệu bị từ chối: trợ lý không có quyền ghi, nên AI không được gọi.',
        ),
      };
    }

    // A scenario question is answered by the deterministic M2d engine first;
    // the model only gets the finished simulation to explain.
    const interpretation = interpretScenario(
      dto.message,
      context.goals.map((goal) => ({
        id: goal.goalId,
        name: goal.goalName,
        status: scenarioGoalStatus(goal.progressStatus),
      })),
      context.today,
    );
    if (interpretation.scenario !== null) {
      const scenario = await this.runScenario(userId, context, interpretation, dto.message);
      return {
        ...base,
        source: scenario.source,
        intent: 'SCENARIO',
        reply: scenario.explanation,
        references:
          scenario.simulation === null
            ? []
            : evidenceList(
                [
                  'capacity',
                  'monthly_budget',
                  ...(scenario.simulation.scenario !== 'MULTI_GOAL_BUDGET'
                    ? [`goal:${scenario.simulation.goalId}`]
                    : []),
                ],
                catalog,
              ),
        scenario: scenario.simulation,
        clarification: scenario.clarification,
        disclosure: scenario.disclosure,
      };
    }

    const intent = classifyIntent(dto.message);

    // A sentence that clearly asks "what if" but lacks a goal or an amount gets
    // a question back rather than a guess.
    if (interpretation.looksLikeScenario && interpretation.clarification) {
      return {
        ...base,
        source: 'FALLBACK',
        intent: 'SCENARIO',
        reply: interpretation.clarification,
        references: [],
        scenario: null,
        clarification: interpretation.clarification,
        disclosure: this.disclosure(this.llm.enabled ? 'not_needed' : 'disabled', false),
      };
    }

    const fallback = fallbackChatReply(context, intent);
    if (!this.llm.enabled || intent === 'UNCLEAR') {
      return {
        ...base,
        source: 'FALLBACK',
        intent,
        reply: fallback.reply,
        references: evidenceList(fallback.referenceKeys, catalog),
        scenario: null,
        clarification: intent === 'UNCLEAR' ? fallback.reply : null,
        disclosure: this.disclosure(this.llm.enabled ? 'not_needed' : 'disabled', false),
      };
    }

    const prompt = buildChatPrompt(context, dto.message, history, Object.keys(catalog));
    try {
      const result = await this.llm.complete({ ...prompt, maxTokens: 1_200 });
      const parsed = parseChatReply(result.text, allowed, new Set(Object.keys(catalog)));
      return {
        ...base,
        source: 'AI',
        intent,
        reply: parsed.reply,
        references: evidenceList(parsed.referenceKeys, catalog),
        scenario: null,
        clarification: null,
        disclosure: this.disclosure(null, true),
      };
    } catch (error) {
      return {
        ...base,
        source: 'FALLBACK',
        intent,
        reply: fallback.reply,
        references: evidenceList(fallback.referenceKeys, catalog),
        scenario: null,
        clarification: null,
        disclosure: this.disclosure(reasonFor(error), false),
      };
    }
  }

  /* --------------------------- internals --------------------------- */

  private async loadContext(userId: string, requestedCurrency?: string): Promise<SavingsAiContext> {
    const recommendations = await this.recommendations.recommend(userId, {
      currency: requestedCurrency,
    });
    const progress = await this.progress.progress(userId, {
      currency: recommendations.currency,
    });
    return buildSavingsAiContext(recommendations, progress);
  }

  private async runScenario(
    userId: string,
    context: SavingsAiContext,
    interpretation: ScenarioInterpretation,
    question: string,
  ): Promise<SavingsScenarioExplanationDto> {
    const base = {
      currency: context.currency,
      timezone: context.timezone,
      generatedAt: new Date().toISOString(),
      requiresConfirmation: true,
      limitations: [
        'Mô phỏng chỉ đọc: không có khoản góp hay thay đổi mục tiêu nào được lưu.',
        'Kết quả dựa trên dữ liệu đã ghi nhận và chưa tính lãi suất, lạm phát hay nghĩa vụ sắp tới.',
      ],
      interpretation: {
        scenario: interpretation.scenario,
        goalId: interpretation.goalId,
        goalName: interpretation.goalName,
        monthlyAmount: interpretation.monthlyAmount,
        targetAmount: interpretation.targetAmount,
        targetDate: interpretation.targetDate,
        budget: interpretation.budget,
        confidence: interpretation.confidence,
      },
    };

    if (interpretation.scenario === null) {
      return {
        ...base,
        status: interpretation.clarification ? 'clarification' : 'unsupported',
        source: 'FALLBACK',
        simulation: null,
        explanation:
          interpretation.clarification ??
          'Mình chưa hiểu kịch bản này. Bạn có thể nói rõ số tiền và mục tiêu muốn mô phỏng.',
        clarification: interpretation.clarification,
        disclosure: this.disclosure(this.llm.enabled ? 'not_needed' : 'disabled', false),
      };
    }

    let simulation: SavingsSimulationDto;
    try {
      simulation = await this.plans.simulate(userId, scenarioInput(context, interpretation));
    } catch (error) {
      const message =
        error instanceof BadRequestException
          ? error.message
          : 'Không thể mô phỏng kịch bản này với dữ liệu hiện tại.';
      return {
        ...base,
        status: 'clarification',
        source: 'FALLBACK',
        simulation: null,
        explanation: message,
        clarification: message,
        disclosure: this.disclosure(this.llm.enabled ? 'not_needed' : 'disabled', false),
      };
    }

    const fallback = fallbackScenarioExplanation(simulation);
    if (!this.llm.enabled) {
      return {
        ...base,
        status: 'simulated',
        source: 'FALLBACK',
        simulation,
        explanation: fallback,
        clarification: null,
        disclosure: this.disclosure('disabled', false),
      };
    }

    const catalog = evidenceCatalog(context);
    const allowed = collectAllowedNumbers(context);
    const prompt = buildScenarioExplanationPrompt(
      context,
      simulation,
      question,
      Object.keys(catalog),
    );
    try {
      const result = await this.llm.complete({ ...prompt, maxTokens: 1_200 });
      const parsed = parseChatReply(result.text, allowed, new Set(Object.keys(catalog)));
      return {
        ...base,
        status: 'simulated',
        source: 'AI',
        simulation,
        explanation: parsed.reply,
        clarification: null,
        disclosure: this.disclosure(null, true),
      };
    } catch (error) {
      return {
        ...base,
        status: 'simulated',
        source: 'FALLBACK',
        simulation,
        explanation: fallback,
        clarification: null,
        disclosure: this.disclosure(reasonFor(error), false),
      };
    }
  }

  private disclosure(
    reason: AiFallbackReason,
    usedModel: boolean,
    noticeOverride?: string,
  ): AiDisclosureDto {
    const notices: Record<string, string> = {
      disabled:
        'AI đang tắt. Nội dung này do quy tắc của hệ thống tạo ra từ dữ liệu thực của bạn, không gửi đi đâu cả.',
      not_configured:
        'AI chưa được cấu hình. Hệ thống dùng giải thích theo quy tắc từ dữ liệu thực của bạn.',
      timeout:
        'AI phản hồi quá lâu nên hệ thống dùng giải thích theo quy tắc từ dữ liệu thực của bạn.',
      rate_limited:
        'AI đang bị giới hạn tần suất nên hệ thống dùng giải thích theo quy tắc từ dữ liệu thực của bạn.',
      provider_error:
        'AI tạm thời không phản hồi nên hệ thống dùng giải thích theo quy tắc từ dữ liệu thực của bạn.',
      invalid_response:
        'Câu trả lời của AI không vượt qua kiểm tra dữ liệu nên hệ thống dùng giải thích theo quy tắc từ dữ liệu thực của bạn.',
      not_needed:
        'Yêu cầu chưa đủ rõ hoặc không cần AI, nên hệ thống trả lời trực tiếp từ dữ liệu thực của bạn.',
    };
    if (usedModel) {
      return {
        aiEnabled: true,
        provider: this.llm.name,
        model: this.llm.model,
        usedModel: true,
        fallbackReason: null,
        notice:
          `Nội dung do AI (${this.llm.name}${this.llm.model ? ` · ${this.llm.model}` : ''}) viết. ` +
          'AI chỉ nhận số liệu tổng hợp do hệ thống tính, không nhận giao dịch, ghi chú hay thông tin đăng nhập.',
      };
    }
    return {
      aiEnabled: this.llm.enabled,
      provider: this.llm.enabled ? this.llm.name : null,
      model: this.llm.enabled ? this.llm.model : null,
      usedModel: false,
      fallbackReason: reason,
      notice: noticeOverride ?? notices[reason ?? 'provider_error'] ?? notices.provider_error,
    };
  }
}

/* ------------------------------ helpers ------------------------------ */

function scenarioInput(context: SavingsAiContext, interpretation: ScenarioInterpretation) {
  switch (interpretation.scenario) {
    case 'MONTHLY_AMOUNT':
      return {
        scenario: 'MONTHLY_AMOUNT' as const,
        goalId: interpretation.goalId ?? '',
        monthlyAmount: interpretation.monthlyAmount ?? '',
      };
    case 'DEADLINE':
      return {
        scenario: 'DEADLINE' as const,
        goalId: interpretation.goalId ?? '',
        targetDate: interpretation.targetDate ?? '',
      };
    case 'TARGET_AMOUNT':
      return {
        scenario: 'TARGET_AMOUNT' as const,
        goalId: interpretation.goalId ?? '',
        targetAmount: interpretation.targetAmount ?? '',
      };
    case 'MULTI_GOAL_BUDGET':
      return {
        scenario: 'MULTI_GOAL_BUDGET' as const,
        budget: interpretation.budget ?? '',
        currency: context.currency,
      };
    default:
      return {
        scenario: 'MONTHLY_AMOUNT' as const,
        goalId: '',
        monthlyAmount: '0',
      };
  }
}

function toExplanationGoal(goal: SavingsAiContext['goals'][number]): SavingsExplanationGoalDto {
  return {
    goalId: goal.goalId,
    goalName: goal.goalName,
    priority: goal.priority,
    priorityReason: goal.priorityReason,
    progressStatus: goal.progressStatus,
    statusReason: goal.statusReason,
    targetDate: goal.targetDate,
    remainingAmount: goal.remainingAmount,
    requiredMonthlySaving: goal.requiredMonthlySaving,
    recommendedMonthlySaving: goal.recommendedMonthlySaving,
    estimatedCompletionDate: goal.estimatedCompletionDate,
    feasibility: goal.feasibility,
    atRisk: goal.atRisk,
  };
}

function scenarioGoalStatus(progressStatus: string): string {
  if (progressStatus === 'COMPLETED') return 'COMPLETED';
  if (progressStatus === 'PAUSED') return 'PAUSED';
  return 'ACTIVE';
}

function classifyIntent(message: string): SavingsChatIntent {
  const text = normalizeText(message);
  if (/(tien do|tinh hinh|trang thai|sao roi|dang the nao)/.test(text)) return 'STATUS';
  if (/(uu tien|nen gop|muc tieu nao|thu tu)/.test(text)) return 'PRIORITY';
  if (/(tai sao|vi sao|giai thich|kha nang|20%|du phong|de xuat)/.test(text)) return 'EXPLAIN';
  return 'UNCLEAR';
}

function reasonFor(error: unknown): AiFallbackReason {
  if (error instanceof LlmUnavailableError) return error.reason;
  if (error instanceof LlmInvalidResponseError) return 'invalid_response';
  return 'provider_error';
}
