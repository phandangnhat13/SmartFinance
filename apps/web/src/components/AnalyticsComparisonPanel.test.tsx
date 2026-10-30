import { render, screen, within } from '@testing-library/react';
import type { AnalyticsPeriodComparisonDto } from '@smart-finance/shared-types';
import { describe, expect, it } from 'vitest';
import { AnalyticsComparisonPanel } from './AnalyticsComparisonPanel';

function makeComparison(
  overrides: Partial<AnalyticsPeriodComparisonDto> = {},
): AnalyticsPeriodComparisonDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    estimated: false,
    current: {
      period: {
        kind: 'month',
        label: '2025-01',
        from: '2025-01-01',
        to: '2025-01-31',
        status: 'in_progress',
      },
      income: '5000000.00',
      expense: '2300000.00',
      net: '2700000.00',
      savingsRate: 54,
      transactionCount: 3,
      hasTransactions: true,
    },
    previous: {
      period: {
        kind: 'month',
        label: '2024-12',
        from: '2024-12-01',
        to: '2024-12-31',
        status: 'complete',
      },
      income: '4000000.00',
      expense: '2000000.00',
      net: '2000000.00',
      savingsRate: 50,
      transactionCount: 2,
      hasTransactions: true,
    },
    changes: {
      income: { amount: '1000000.00', percent: 25 },
      expense: { amount: '300000.00', percent: 15 },
      net: { amount: '700000.00', percent: 35 },
      savingsRatePoints: 4,
    },
    notableCategoryChanges: [
      {
        categoryId: 'food',
        categoryName: 'Ăn uống',
        currentTotal: '2000000.00',
        previousTotal: '1000000.00',
        changeAmount: '1000000.00',
        changePercent: 100,
        direction: 'increase',
      },
      {
        categoryId: 'transport',
        categoryName: 'Đi lại',
        currentTotal: '300000.00',
        previousTotal: '0.00',
        changeAmount: '300000.00',
        changePercent: null,
        direction: 'new',
      },
    ],
    ...overrides,
  };
}

function rowFor(label: string): HTMLElement {
  const cell = screen.getByText(label, { selector: 'th' });
  const row = cell.closest('tr');
  if (!row) throw new Error(`No row for ${label}`);
  return row as HTMLElement;
}

describe('AnalyticsComparisonPanel', () => {
  it('compares both periods and states the change in money and percent', () => {
    render(<AnalyticsComparisonPanel data={makeComparison()} currency="VND" />);

    expect(screen.getByText('2025-01')).toBeInTheDocument();
    expect(screen.getByText('2024-12')).toBeInTheDocument();
    expect(screen.getByText('Đang diễn ra')).toBeInTheDocument();
    expect(screen.getByText('Đã kết thúc')).toBeInTheDocument();

    const income = rowFor('Thu nhập');
    expect(within(income).getByText(/5\.000\.000/)).toBeInTheDocument();
    expect(within(income).getByText(/4\.000\.000/)).toBeInTheDocument();
    expect(within(income).getByText(/\+1\.000\.000/)).toBeInTheDocument();
    expect(within(income).getByText(/\(\+25\.0%\)/)).toBeInTheDocument();

    const savings = rowFor('Tỷ lệ tiết kiệm');
    expect(within(savings).getByText('54.0%')).toBeInTheDocument();
    expect(within(savings).getByText('50.0%')).toBeInTheDocument();
    expect(within(savings).getByText('+4.0 điểm %')).toBeInTheDocument();

    const count = rowFor('Số giao dịch');
    expect(within(count).getByText('3')).toBeInTheDocument();
    expect(within(count).getByText('2')).toBeInTheDocument();
    expect(within(count).getByText('—')).toBeInTheDocument();
  });

  it('marks a missing baseline with a dash instead of an infinite percentage', () => {
    render(
      <AnalyticsComparisonPanel
        data={makeComparison({
          previous: {
            period: {
              kind: 'month',
              label: '2024-12',
              from: '2024-12-01',
              to: '2024-12-31',
              status: 'complete',
            },
            income: '0.00',
            expense: '0.00',
            net: '0.00',
            savingsRate: null,
            transactionCount: 0,
            hasTransactions: false,
          },
          changes: {
            income: { amount: '5000000.00', percent: null },
            expense: { amount: '2300000.00', percent: null },
            net: { amount: '2700000.00', percent: null },
            savingsRatePoints: null,
          },
        })}
        currency="VND"
      />,
    );

    expect(screen.getByText(/chưa có giao dịch thu hoặc chi/)).toBeInTheDocument();
    expect(within(rowFor('Thu nhập')).getByText(/\(—\)/)).toBeInTheDocument();
    expect(within(rowFor('Tỷ lệ tiết kiệm')).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('lists notable category changes with a neutral direction badge', () => {
    render(<AnalyticsComparisonPanel data={makeComparison()} currency="VND" />);

    expect(screen.getByText('Ăn uống')).toBeInTheDocument();
    expect(screen.getByText('Tăng')).toBeInTheDocument();
    expect(screen.getByText('Đi lại')).toBeInTheDocument();
    expect(screen.getByText('Chi tiêu mới')).toBeInTheDocument();
    expect(screen.getByText(/\(\+100\.0%\)/)).toBeInTheDocument();
    expect(screen.getByText(/tối đa 10 danh mục/)).toBeInTheDocument();
  });

  it('says so when no category changed between the periods', () => {
    render(
      <AnalyticsComparisonPanel
        data={makeComparison({ notableCategoryChanges: [] })}
        currency="VND"
      />,
    );

    expect(
      screen.getByText('Không có danh mục chi tiêu nào thay đổi giữa hai kỳ.'),
    ).toBeInTheDocument();
  });
});
