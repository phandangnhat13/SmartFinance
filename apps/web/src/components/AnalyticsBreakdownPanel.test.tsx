import { render, screen } from '@testing-library/react';
import type { AnalyticsExpenseDto, AnalyticsIncomeDto } from '@smart-finance/shared-types';
import { describe, expect, it } from 'vitest';
import { AnalyticsBreakdownPanel } from './AnalyticsBreakdownPanel';

function makeIncome(overrides: Partial<AnalyticsIncomeDto> = {}): AnalyticsIncomeDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    rangeMonths: 2,
    estimated: false,
    points: [
      {
        month: '2024-12',
        monthStatus: 'complete',
        amount: '4000000.00',
        hasTransactions: true,
        changePercent: null,
      },
      {
        month: '2025-01',
        monthStatus: 'complete',
        amount: '5000000.00',
        hasTransactions: true,
        changePercent: 25,
      },
    ],
    total: '9000000.00',
    averageMonthly: '4500000.00',
    monthsWithIncome: 2,
    highest: { month: '2025-01', amount: '5000000.00' },
    lowest: { month: '2024-12', amount: '4000000.00' },
    sources: [
      {
        categoryId: 'salary',
        categoryName: 'Lương',
        total: '9000000.00',
        sharePercent: 100,
        transactionCount: 2,
      },
    ],
    ...overrides,
  };
}

function makeExpense(overrides: Partial<AnalyticsExpenseDto> = {}): AnalyticsExpenseDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    rangeMonths: 2,
    estimated: false,
    points: [
      {
        month: '2024-12',
        monthStatus: 'complete',
        amount: '1000000.00',
        hasTransactions: true,
        changePercent: null,
      },
      {
        month: '2025-01',
        monthStatus: 'complete',
        amount: '2000000.00',
        hasTransactions: true,
        changePercent: 100,
      },
    ],
    total: '3000000.00',
    averageMonthly: '1500000.00',
    monthsWithExpense: 2,
    highest: { month: '2025-01', amount: '2000000.00' },
    lowest: { month: '2024-12', amount: '1000000.00' },
    volatilityPercent: 33.33,
    longestIncreasingStreak: 1,
    currentIncreasingStreak: 1,
    ...overrides,
  };
}

describe('AnalyticsBreakdownPanel — income', () => {
  it('shows totals, extremes, monthly change and category sources', () => {
    render(<AnalyticsBreakdownPanel kind="income" data={makeIncome()} currency="VND" />);

    expect(screen.getByText('Phân tích thu nhập')).toBeInTheDocument();
    expect(screen.getAllByText(/9\.000\.000/).length).toBeGreaterThan(0);
    expect(screen.getByText(/4\.500\.000/)).toBeInTheDocument();
    expect(screen.getByText('2 tháng có thu')).toBeInTheDocument();
    expect(screen.getByText('Tháng cao nhất')).toBeInTheDocument();
    expect(screen.getByText('Tháng thấp nhất')).toBeInTheDocument();
    expect(screen.getByText('+25.0%')).toBeInTheDocument();
    // The first month has no earlier baseline, so it shows a dash.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);

    expect(screen.getByText('Cơ cấu nguồn thu theo danh mục')).toBeInTheDocument();
    expect(screen.getByText('Lương')).toBeInTheDocument();
    expect(screen.getByText(/100\.0% tổng thu · 2 giao dịch/)).toBeInTheDocument();
    expect(screen.getByText(/không suy đoán/)).toBeInTheDocument();
  });

  it('states that there is no income instead of rendering all-zero statistics', () => {
    render(
      <AnalyticsBreakdownPanel
        kind="income"
        data={makeIncome({
          total: '0.00',
          averageMonthly: null,
          monthsWithIncome: 0,
          highest: null,
          lowest: null,
          sources: [],
          points: makeIncome().points.map((point) => ({
            ...point,
            amount: '0.00',
            hasTransactions: false,
            changePercent: null,
          })),
        })}
        currency="VND"
      />,
    );

    expect(screen.getByText('Không có giao dịch thu nhập trong khoảng này.')).toBeInTheDocument();
    expect(screen.getByText('Chưa có thu nhập để phân chia theo danh mục.')).toBeInTheDocument();
  });
});

describe('AnalyticsBreakdownPanel — expense', () => {
  it('describes volatility and increasing streaks without judging spending', () => {
    render(<AnalyticsBreakdownPanel kind="expense" data={makeExpense()} currency="VND" />);

    expect(screen.getByText('Phân tích chi tiêu')).toBeInTheDocument();
    expect(screen.getByText('33.33%')).toBeInTheDocument();
    expect(screen.getByText('Dài nhất: 1 tháng')).toBeInTheDocument();
    expect(screen.getByText('Đang tiếp diễn ở tháng cuối: 1 tháng')).toBeInTheDocument();
    expect(screen.getByText(/không kết luận về thói quen chi tiêu/)).toBeInTheDocument();
    expect(screen.queryByText('Cơ cấu nguồn thu theo danh mục')).not.toBeInTheDocument();
  });

  it('shows a dash when there are too few months to measure volatility', () => {
    render(
      <AnalyticsBreakdownPanel
        kind="expense"
        data={makeExpense({
          volatilityPercent: null,
          longestIncreasingStreak: 0,
          currentIncreasingStreak: 0,
        })}
        currency="VND"
      />,
    );

    expect(screen.getByText('Cần ít nhất 2 tháng có chi tiêu để tính.')).toBeInTheDocument();
    expect(screen.getByText('Dài nhất: 0 tháng')).toBeInTheDocument();
  });
});
