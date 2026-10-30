import type { SimulationScenario } from '@smart-finance/shared-types';

/**
 * Deterministic Vietnamese scenario parser (M2e phase 3).
 *
 * The LLM is never asked to interpret the user's numbers: the backend parses
 * the message with plain rules, validates the result, and only then calls the
 * existing M2d simulation service. Anything the parser cannot pin down becomes
 * a clarification question instead of a guess.
 */

export interface ScenarioGoalOption {
  id: string;
  name: string;
  status: string;
}

export interface ScenarioInterpretation {
  scenario: SimulationScenario | null;
  goalId: string | null;
  goalName: string | null;
  monthlyAmount: string | null;
  targetAmount: string | null;
  targetDate: string | null;
  budget: string | null;
  confidence: 'high' | 'medium' | 'low';
  /** Question to ask when a field is missing or ambiguous. */
  clarification: string | null;
  /** True when the message looks like a scenario but could not be parsed. */
  looksLikeScenario: boolean;
}

const EMPTY: ScenarioInterpretation = {
  scenario: null,
  goalId: null,
  goalName: null,
  monthlyAmount: null,
  targetAmount: null,
  targetDate: null,
  budget: null,
  confidence: 'low',
  clarification: null,
  looksLikeScenario: false,
};

/** Diacritic-insensitive, lower-cased copy used only for keyword matching. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Money candidates in a Vietnamese sentence, in the order they appear. */
export function extractAmounts(message: string): number[] {
  const text = normalizeText(message);
  const amounts: number[] = [];
  const push = (value: number) => {
    if (Number.isFinite(value) && value > 0 && value <= 999_999_999_999_999) {
      amounts.push(Math.round(value * 100) / 100);
    }
  };

  // Scale words first, so "3 triệu" is not also read as the bare number 3.
  const scaled = /(\d+(?:[.,]\d+)?)\s*(trieu|tr|million|nghin|ngan|k)\b/g;
  let match: RegExpExecArray | null;
  while ((match = scaled.exec(text)) !== null) {
    const unit = match[2];
    const base = Number(match[1].replace(',', '.'));
    const multiplier = ['trieu', 'tr', 'million'].includes(unit) ? 1_000_000 : 1_000;
    push(base * multiplier);
  }

  // Explicit currency amounts with thousands separators: 2.000.000đ, 15.000.000 VND.
  // The suffix is optional because "thành 15.000.000" is a common way to write it.
  const grouped = /(?<![\d.])(\d{1,3}(?:[.,]\d{3})+)(?![.,]\d)/g;
  while ((match = grouped.exec(text)) !== null) {
    push(Number(match[1].replace(/[.,]/g, '')));
  }

  const suffixed = /\b(\d{4,})(?:\s*(?:d|vnd|dong|₫))\b/g;
  while ((match = suffixed.exec(text)) !== null) {
    push(Number(match[1]));
  }

  // Bare large numbers ("góp 2000000") are treated as an amount.
  const bare = /\b(\d{5,})\b/g;
  while ((match = bare.exec(text)) !== null) {
    push(Number(match[1]));
  }

  // De-duplicate while keeping the first occurrence order.
  return amounts.filter((value, index) => amounts.indexOf(value) === index);
}

/** One date from the message as YYYY-MM-DD, or null when absent/invalid. */
export function extractDate(message: string, today: string): string | null {
  const iso = message.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const candidate = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isValidDate(candidate) ? candidate : null;
  }
  const dayFirst = message.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (dayFirst) {
    const candidate = `${dayFirst[3]}-${dayFirst[2].padStart(2, '0')}-${dayFirst[1].padStart(2, '0')}`;
    return isValidDate(candidate) && candidate > today ? candidate : null;
  }
  return null;
}

function isValidDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Best matching goal by name; falls back to the only active goal. */
export function matchGoal(
  message: string,
  goals: ScenarioGoalOption[],
): { goal: ScenarioGoalOption | null; byName: boolean } {
  const text = normalizeText(message);
  const active = goals.filter((goal) => goal.status === 'ACTIVE');
  const candidates = active.length > 0 ? active : goals;
  const byName = [...candidates]
    .filter((goal) => normalizeText(goal.name).length >= 3)
    .filter((goal) => text.includes(normalizeText(goal.name)))
    .sort((left, right) => right.name.length - left.name.length);
  if (byName.length > 0) return { goal: byName[0], byName: true };
  if (active.length === 1) return { goal: active[0], byName: false };
  return { goal: null, byName: false };
}

export function interpretScenario(
  message: string,
  goals: ScenarioGoalOption[],
  today: string,
): ScenarioInterpretation {
  const text = normalizeText(message);
  const amounts = extractAmounts(message);
  const amount = amounts[0] ?? null;
  const date = extractDate(message, today);
  const { goal, byName } = matchGoal(message, goals);

  const wantsTarget =
    /(doi|tang|giam|dat|chinh)\s+(muc tieu|muc tieu moi)|muc tieu\s+(moi|thanh|len)/.test(text);
  // Word boundaries matter here: "tháng" normalises to "thang", which would
  // otherwise match "han" and turn every monthly question into a deadline one.
  const wantsDeadline = /\b(han|deadline|ngay dich|gia han|doi han|tre han)\b/.test(text);
  const wantsBudget = /(ngan sach|tong so tien|phan bo|chia deu|tong gop)/.test(text);
  const wantsMonthly = /(moi thang|hang thang|\/thang|\bgop\b|tiet kiem|de danh|danh ra)/.test(
    text,
  );
  const looksLikeScenario = /(neu|gia su|thu xem|mo phong|thi sao|lieu)/.test(text);

  const base = {
    ...EMPTY,
    goalId: goal?.id ?? null,
    goalName: goal?.name ?? null,
    looksLikeScenario,
  };

  const needGoalClarification = (): ScenarioInterpretation => ({
    ...base,
    clarification: `Bạn muốn mô phỏng cho mục tiêu nào? Hiện có: ${
      goals.map((item) => item.name).join(', ') || 'chưa có mục tiêu nào'
    }.`,
  });

  if (wantsTarget && amount !== null) {
    if (!goal) return needGoalClarification();
    return {
      ...base,
      scenario: 'TARGET_AMOUNT',
      targetAmount: String(amount),
      confidence: byName ? 'high' : 'medium',
    };
  }

  if (wantsDeadline && date) {
    if (!goal) return needGoalClarification();
    return {
      ...base,
      scenario: 'DEADLINE',
      targetDate: date,
      confidence: byName ? 'high' : 'medium',
    };
  }
  if (wantsDeadline && !date) {
    return {
      ...base,
      clarification: 'Bạn muốn dời ngày đích sang ngày nào? Ví dụ: 30/06/2027.',
      looksLikeScenario: true,
    };
  }

  if (wantsBudget && amount !== null) {
    return { ...base, scenario: 'MULTI_GOAL_BUDGET', budget: String(amount), confidence: 'high' };
  }

  if (amount !== null && (wantsMonthly || looksLikeScenario || amounts.length === 1)) {
    if (!goal) return needGoalClarification();
    return {
      ...base,
      scenario: 'MONTHLY_AMOUNT',
      monthlyAmount: String(amount),
      confidence: byName && wantsMonthly ? 'high' : 'medium',
    };
  }

  if (amount === null) {
    const scenarioHint =
      looksLikeScenario || wantsMonthly || wantsDeadline || wantsBudget || wantsTarget;
    return {
      ...base,
      looksLikeScenario: scenarioHint,
      clarification: scenarioHint
        ? 'Mình chưa thấy số tiền hoặc ngày cụ thể. Bạn thử nói rõ hơn, ví dụ: “Nếu góp 2.000.000 ₫ mỗi tháng cho mục tiêu Du lịch thì sao?”'
        : null,
    };
  }

  return {
    ...base,
    clarification:
      'Bạn muốn mô phỏng điều gì? Ví dụ: góp thêm mỗi tháng, dời ngày đích, hoặc đổi số tiền mục tiêu.',
  };
}
