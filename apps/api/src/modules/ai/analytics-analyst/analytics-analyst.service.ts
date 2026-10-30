import { Inject, Injectable } from '@nestjs/common';
import type {
  AiDisclosureDto,
  AiEvidenceDto,
  AiFallbackReason,
  AnalyticsAiChatIntent,
  AnalyticsAiChatReplyDto,
  AnalyticsAiExplanationDto,
  AnalyticsAiFactsDto,
  AnalyticsAiHighlightDto,
  AnalyticsAiRecommendationDto,
  AnalyticsAiRecommendationsDto,
  AnalyticsAiSummaryDto,
} from '@smart-finance/shared-types';
import { AnalyticsForecastService } from '../../analytics-forecast/analytics-forecast.service';
import { CategoryBudgetAnalyticsService } from '../../analytics-category-budget/category-budget-analytics.service';
import { FinancialHealthService } from '../../analytics-financial-health/financial-health.service';
import { AnalyticsTrendsService } from '../../analytics-trends/analytics-trends.service';
import { SavingsRecommendationService } from '../../insights/savings-recommendation.service';
import {
  LlmInvalidResponseError,
  LlmUnavailableError,
  LLM_PROVIDER,
  type LlmProvider,
} from '../llm/llm.types';
import { normalizeText } from '../savings-assistant/savings-intent';
import {
  analyticsEvidenceCatalog,
  analyticsEvidenceList,
  buildAnalyticsAiContext,
  buildAnalyticsAiFacts,
  collectAnalyticsNumbers,
  type AnalyticsAiContext,
} from './analytics-context';
import {
  buildChatPrompt,
  buildExplanationPrompt,
  buildRecommendationsPrompt,
  buildSummaryPrompt,
  parseChatReply,
  parseExplanation,
  parseRecommendations,
  parseSummary,
} from './analytics-ai-output';
import {
  fallbackChatReply,
  fallbackExplanation,
  fallbackRecommendations,
  fallbackSummary,
} from './analytics-fallback';
import type {
  AnalyticsAiChatRequestDto,
  AnalyticsAiExplainRequestDto,
  AnalyticsAiQueryDto,
  AnalyticsAiRecommendationsRequestDto,
  AnalyticsAiSummaryRequestDto,
} from './dto/analytics-analyst.dto';

const DATA_NOTICE =
  'Mình không thể tạo, sửa hay xóa giao dịch, ngân sách, mục tiêu, khoản góp hay số dư. Bạn hãy dùng màn hình tương ứng để thực hiện thay đổi.';

const UNSUPPORTED_PATTERN =
  /(tao|xoa|sua|them|cap nhat|chuyen|thanh toan|doi mat khau)\s+(giao dich|ngan sach|muc tieu|khoan gop|so du|tai khoan|mat khau)/;

const DEFAULT_TREND_MONTHS = 6;

type ContextSection = 'trends' | 'categories' | 'budgets' | 'forecast' | 'health' | 'savings';

const SECTION_BY_INTENT: Record<AnalyticsAiChatIntent, ContextSection[]> = {
  SUMMARY: ['trends', 'categories', 'budgets'],
  EXPLAIN: ['trends', 'categories', 'budgets', 'forecast', 'health'],
  HEALTH: ['health'],
  FORECAST: ['forecast'],
  BUDGET: ['budgets'],
  CATEGORY: ['categories'],
  SAVINGS: ['savings'],
  UNSUPPORTED: [],
  UNCLEAR: [],
};

/**
 * AI financial analyst (M3e).
 *
 * The deterministic services remain the only source of financial values: M3a
 * supplies overview/trends, M3b categories/budgets, M3c the forecast, M3d the
 * health score and M2c the savings plan. The model receives only the context
 * those services produced and returns prose plus evidence keys. It can never
 * write data — no dependency injected here exposes a write path, and no prompt
 * asks for one.
 */
@Injectable()
export class AnalyticsAnalystService {
  constructor(
    private readonly trends: AnalyticsTrendsService,
    private readonly budgets: CategoryBudgetAnalyticsService,
    private readonly forecast: AnalyticsForecastService,
    private readonly financialHealth: FinancialHealthService,
    private readonly savings: SavingsRecommendationService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  async summary(userId: string, dto: AnalyticsAiSummaryRequestDto): Promise<AnalyticsAiSummaryDto> {
    const context = await this.loadContext(userId, dto, [
      'trends',
      'categories',
      'budgets',
      'health',
    ]);
    const catalog = analyticsEvidenceCatalog(context);
    const allowed = collectAnalyticsNumbers(context);
    const fallback = fallbackSummary(context);
    const fallbackKeys = [
      'overview_income',
      'overview_expense',
      'overview_net',
      'savings_rate',
      'budgets_summary',
      'forecast_net',
      'health_overall',
    ];

    if (!this.llm.enabled) {
      return {
        ...this.common(context, analyticsEvidenceList(fallbackKeys, catalog)),
        source: 'FALLBACK',
        summary: fallback.summary,
        highlights: fallback.highlights,
        disclosure: this.disclosure('disabled', false),
      };
    }

    const prompt = buildSummaryPrompt(context, Object.keys(catalog));
    try {
      const result = await this.llm.complete({ ...prompt, maxTokens: 1_600 });
      const parsed = parseSummary(result.text, allowed, new Set(Object.keys(catalog)));
      const highlights: AnalyticsAiHighlightDto[] = parsed.highlights.map((highlight) => ({
        title: highlight.title,
        body: highlight.body,
        evidence: analyticsEvidenceList(highlight.evidenceKeys, catalog),
      }));
      return {
        ...this.common(
          context,
          analyticsEvidenceList(
            uniqueKeys(parsed.highlights.flatMap((item) => item.evidenceKeys)),
            catalog,
          ),
        ),
        source: 'AI',
        summary: parsed.summary,
        highlights,
        disclosure: this.disclosure(null, true),
      };
    } catch (error) {
      return {
        ...this.common(context, analyticsEvidenceList(fallbackKeys, catalog)),
        source: 'FALLBACK',
        summary: fallback.summary,
        highlights: fallback.highlights,
        disclosure: this.disclosure(reasonFor(error), false),
      };
    }
  }

  async explain(
    userId: string,
    dto: AnalyticsAiExplainRequestDto,
  ): Promise<AnalyticsAiExplanationDto> {
    const context = await this.loadContext(userId, dto, [
      'trends',
      'categories',
      'budgets',
      'forecast',
      'health',
    ]);
    const catalog = analyticsEvidenceCatalog(context);
    const allowed = collectAnalyticsNumbers(context);
    const fallback = fallbackExplanation(context);
    const fallbackKeys = ['overview_income', 'overview_expense', 'overview_net', 'savings_rate'];

    if (!this.llm.enabled) {
      return {
        ...this.common(context, analyticsEvidenceList(fallbackKeys, catalog)),
        source: 'FALLBACK',
        summary: fallback.summary,
        sections: fallback.sections,
        disclosure: this.disclosure('disabled', false),
      };
    }

    const prompt = buildExplanationPrompt(
      context,
      dto.question?.trim() || null,
      Object.keys(catalog),
    );
    try {
      const result = await this.llm.complete({ ...prompt, maxTokens: 1_800 });
      const parsed = parseExplanation(result.text, allowed, new Set(Object.keys(catalog)));
      return {
        ...this.common(context, analyticsEvidenceList(parsed.evidenceKeys, catalog)),
        source: 'AI',
        summary: parsed.summary,
        sections: parsed.sections,
        disclosure: this.disclosure(null, true),
      };
    } catch (error) {
      return {
        ...this.common(context, analyticsEvidenceList(fallbackKeys, catalog)),
        source: 'FALLBACK',
        summary: fallback.summary,
        sections: fallback.sections,
        disclosure: this.disclosure(reasonFor(error), false),
      };
    }
  }

  async recommendations(
    userId: string,
    dto: AnalyticsAiRecommendationsRequestDto,
  ): Promise<AnalyticsAiRecommendationsDto> {
    const context = await this.loadContext(userId, dto, [
      'budgets',
      'forecast',
      'health',
      'savings',
    ]);
    const catalog = analyticsEvidenceCatalog(context);
    const allowed = collectAnalyticsNumbers(context);

    const fallback = fallbackRecommendations(context);
    if (!this.llm.enabled) {
      return {
        ...this.common(context, analyticsEvidenceList(fallback.referenceKeys, catalog)),
        source: 'FALLBACK',
        recommendations: fallback.recommendations,
        disclosure: this.disclosure('disabled', false),
      };
    }

    const prompt = buildRecommendationsPrompt(context, Object.keys(catalog));
    try {
      const result = await this.llm.complete({ ...prompt, maxTokens: 1_600 });
      const parsed = parseRecommendations(result.text, allowed, new Set(Object.keys(catalog)));
      const recommendations: AnalyticsAiRecommendationDto[] = parsed.map((item, index) => ({
        id: `ai-${index + 1}`,
        title: item.title,
        detail: item.detail,
        evidence: analyticsEvidenceList(item.evidenceKeys, catalog),
        expectedImpact: item.expectedImpact,
        confidence: item.confidence,
        limitations: item.limitations,
        requiresConfirmation: true,
      }));
      return {
        ...this.common(
          context,
          analyticsEvidenceList(uniqueKeys(parsed.flatMap((item) => item.evidenceKeys)), catalog),
        ),
        source: 'AI',
        recommendations,
        disclosure: this.disclosure(null, true),
      };
    } catch (error) {
      return {
        ...this.common(context, analyticsEvidenceList(fallback.referenceKeys, catalog)),
        source: 'FALLBACK',
        recommendations: fallback.recommendations,
        disclosure: this.disclosure(reasonFor(error), false),
      };
    }
  }

  async chat(userId: string, dto: AnalyticsAiChatRequestDto): Promise<AnalyticsAiChatReplyDto> {
    const intent = classifyIntent(dto.message);

    // A write request never reaches the model, and never needs the full profile.
    if (UNSUPPORTED_PATTERN.test(normalizeText(dto.message))) {
      const context = await this.loadContext(userId, dto, []);
      const fallback = fallbackChatReply(context, 'UNSUPPORTED');
      return {
        ...this.common(context, []),
        source: 'FALLBACK',
        intent: 'UNSUPPORTED',
        reply: fallback.reply,
        clarification: DATA_NOTICE,
        disclosure: this.disclosure(
          null,
          false,
          'Yêu cầu thay đổi dữ liệu bị từ chối: trợ lý không có quyền ghi, nên AI không được gọi.',
        ),
      };
    }

    const context = await this.loadContext(userId, dto, SECTION_BY_INTENT[intent]);
    const catalog = analyticsEvidenceCatalog(context);
    const allowed = collectAnalyticsNumbers(context);
    const fallback = fallbackChatReply(context, intent);

    // A vague question gets a clarifying question, not a guess and not a model call.
    if (intent === 'UNCLEAR' || !this.llm.enabled) {
      return {
        ...this.common(context, analyticsEvidenceList(fallback.referenceKeys, catalog)),
        source: 'FALLBACK',
        intent,
        reply: fallback.reply,
        clarification: intent === 'UNCLEAR' ? fallback.reply : null,
        disclosure: this.disclosure(this.llm.enabled ? 'not_needed' : 'disabled', false),
      };
    }

    const prompt = buildChatPrompt(context, dto.message, Object.keys(catalog));
    try {
      const result = await this.llm.complete({ ...prompt, maxTokens: 1_200 });
      const parsed = parseChatReply(result.text, allowed, new Set(Object.keys(catalog)));
      return {
        ...this.common(context, analyticsEvidenceList(parsed.referenceKeys, catalog)),
        source: 'AI',
        intent,
        reply: parsed.reply,
        clarification: parsed.clarification,
        disclosure: this.disclosure(null, true),
      };
    } catch (error) {
      return {
        ...this.common(context, analyticsEvidenceList(fallback.referenceKeys, catalog)),
        source: 'FALLBACK',
        intent,
        reply: fallback.reply,
        clarification: null,
        disclosure: this.disclosure(reasonFor(error), false),
      };
    }
  }

  /* --------------------------- internals --------------------------- */

  /**
   * Loads only the sections a function needs. Overview is always loaded first
   * because it resolves the currency every other service must use, and its
   * figures appear in `facts` for every response.
   */
  private async loadContext(
    userId: string,
    dto: AnalyticsAiQueryDto,
    sections: ContextSection[],
  ): Promise<AnalyticsAiContext> {
    const overview = await this.trends.overview(userId, {
      currency: dto.currency,
      period: 'month',
    });
    const currency = overview.currency;
    const months = dto.months ?? DEFAULT_TREND_MONTHS;
    const wanted = new Set(sections);

    const [trends, categories, budgets, forecast, health, savings] = await Promise.all([
      wanted.has('trends')
        ? this.trends.trends(userId, { currency, months })
        : Promise.resolve(undefined),
      wanted.has('categories')
        ? this.budgets.categories(userId, {
            currency,
            period: 'month',
            type: 'EXPENSE',
            months,
          })
        : Promise.resolve(undefined),
      wanted.has('budgets')
        ? this.budgets.budgets(userId, { currency })
        : Promise.resolve(undefined),
      wanted.has('forecast')
        ? this.forecast.forecast(userId, { currency, horizon: 'current_month' })
        : Promise.resolve(undefined),
      wanted.has('health')
        ? this.financialHealth.health(userId, { currency })
        : Promise.resolve(undefined),
      wanted.has('savings')
        ? this.savings.recommend(userId, { currency })
        : Promise.resolve(undefined),
    ]);

    return buildAnalyticsAiContext({
      overview,
      ...(trends ? { trends } : {}),
      ...(categories ? { categories } : {}),
      ...(budgets ? { budgets } : {}),
      ...(forecast ? { forecast } : {}),
      ...(health ? { health } : {}),
      ...(savings ? { savings } : {}),
    });
  }

  private common(context: AnalyticsAiContext, evidence: AiEvidenceDto[]) {
    const facts: AnalyticsAiFactsDto = buildAnalyticsAiFacts(context);
    return {
      currency: context.currency,
      timezone: context.timezone,
      generatedAt: new Date().toISOString(),
      facts,
      evidence,
      limitations: context.limitations,
      canModifyData: false as const,
    };
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
        'AI chưa được cấu hình. Hệ thống dùng nội dung theo quy tắc từ dữ liệu thực của bạn.',
      timeout:
        'AI phản hồi quá lâu nên hệ thống dùng nội dung theo quy tắc từ dữ liệu thực của bạn.',
      rate_limited:
        'AI đang bị giới hạn tần suất nên hệ thống dùng nội dung theo quy tắc từ dữ liệu thực của bạn.',
      provider_error:
        'AI tạm thời không phản hồi nên hệ thống dùng nội dung theo quy tắc từ dữ liệu thực của bạn.',
      invalid_response:
        'Câu trả lời của AI không vượt qua kiểm tra dữ liệu nên hệ thống dùng nội dung theo quy tắc từ dữ liệu thực của bạn.',
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
          'AI chỉ nhận số liệu tổng hợp do hệ thống tính, không nhận giao dịch, ghi chú, email hay thông tin đăng nhập.',
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

function classifyIntent(message: string): AnalyticsAiChatIntent {
  const text = normalizeText(message);
  if (/(suc khoe|diem|score|danh gia|xep loai)/.test(text)) return 'HEALTH';
  if (/(du bao|forecast|thang toi|sap toi|cuoi thang)/.test(text)) return 'FORECAST';
  if (/(ngan sach|budget|han muc)/.test(text)) return 'BUDGET';
  if (/(danh muc|category|nhom chi|chi nhieu|chi tieu theo)/.test(text)) return 'CATEGORY';
  if (/(tiet kiem|muc tieu|goal|gop von|khoan gop)/.test(text)) return 'SAVINGS';
  if (/(tom tat|tong quan|tinh hinh|summary|the nao|bao nhieu)/.test(text)) return 'SUMMARY';
  if (/(tai sao|vi sao|giai thich|explain|tang|giam|chenh lech)/.test(text)) return 'EXPLAIN';
  return 'UNCLEAR';
}

function reasonFor(error: unknown): AiFallbackReason {
  if (error instanceof LlmUnavailableError) return error.reason;
  if (error instanceof LlmInvalidResponseError) return 'invalid_response';
  return 'provider_error';
}

function uniqueKeys(keys: string[]): string[] {
  return [...new Set(keys)];
}
