import { render, screen } from '@testing-library/react';
import type {
  AnalyticsBudgetPaceDto,
  AnalyticsBudgetsDto,
  BudgetAnalyticsItemDto,
} from '@smart-finance/shared-types';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsBudgetPanel } from './AnalyticsBudgetPanel';

vi.mock('recharts', () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Container,
    BarChart: Container,
    Bar: () => null,
    Cell: () => null,
    CartesianGrid: () => null,
    Legend: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

function item(overrides: Partial<BudgetAnalyticsItemDto> = {}): BudgetAnalyticsItemDto {
  return {
    id: 'b1',
    name: 'Tổng chi tháng 1',
    categoryId: null,
    categoryName: null,
    limitAmount: '3000000.00',
    spent: '3200000.00',
    remaining: '-200000.00',
    usagePercent: 106.67,
    status: 'EXCEEDED',
    warningThreshold: 80,
    periodStart: '2025-01-01',
    periodEnd: '2025-01-31',
    totalDays: 31,
    daysElapsed: 31,
    daysRemaining: 0,
    dailySpendingAverage: '103225.81',
    expectedSpend: '3000000.00',
    variance: '200000.00',
    pacePercent: 106.67,
    estimatedExhaustionDate: null,
    exhaustionProjection: 'already_exceeded',
    transactionCount: 3,
    ...overrides,
  };
}

function makeBudgets(items: BudgetAnalyticsItemDto[]): AnalyticsBudgetsDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    month: '2025-01',
    estimated: false,
    asOf: '2025-01-31',
    monthStatus: 'complete',
    assumesLimitCurrency: 'VND',
    summary: {
      budgetCount: items.length,
      exceededCount: items.filter((entry) => entry.status === 'EXCEEDED').length,
      warningCount: items.filter((entry) => entry.status === 'WARNING').length,
      onTrackCount: items.filter((entry) => entry.status === 'ON_TRACK').length,
      notStartedCount: items.filter((entry) => entry.status === 'NOT_STARTED').length,
      completedCount: items.filter((entry) => entry.status === 'COMPLETED').length,
    },
    items,
  };
}

function makePace(items: BudgetAnalyticsItemDto[]): AnalyticsBudgetPaceDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    month: '2025-01',
    estimated: false,
    asOf: '2025-01-31',
    items: items.map((entry) => ({
      budgetId: entry.id,
      name: entry.name,
      categoryId: entry.categoryId,
      categoryName: entry.categoryName,
      status: entry.status,
      limitAmount: entry.limitAmount,
      spent: entry.spent,
      expectedSpend: entry.expectedSpend,
      variance: entry.variance,
      pacePercent: entry.pacePercent,
      dailySpendingAverage: entry.dailySpendingAverage,
      daysElapsed: entry.daysElapsed,
      daysRemaining: entry.daysRemaining,
      estimatedExhaustionDate: entry.estimatedExhaustionDate,
      exhaustionProjection: entry.exhaustionProjection,
    })),
  };
}

function renderPanel(items: BudgetAnalyticsItemDto[]) {
  return render(
    <MemoryRouter>
      <AnalyticsBudgetPanel data={makeBudgets(items)} pace={makePace(items)} currency="VND" />
    </MemoryRouter>,
  );
}

describe('AnalyticsBudgetPanel', () => {
  it('shows usage, days and pace with explicit statuses', () => {
    renderPanel([
      item(),
      item({
        id: 'b2',
        name: 'Ăn uống tháng 1',
        categoryId: 'food',
        categoryName: 'Ăn uống',
        limitAmount: '2000000.00',
        spent: '1500000.00',
        remaining: '500000.00',
        usagePercent: 75,
        status: 'ON_TRACK',
        daysElapsed: 20,
        daysRemaining: 11,
        expectedSpend: '1290322.58',
        variance: '209677.42',
        pacePercent: 116.25,
        estimatedExhaustionDate: '2025-01-27',
        exhaustionProjection: 'within_period',
      }),
    ]);

    expect(screen.getByText('Ngân sách tháng 01/2025')).toBeInTheDocument();
    expect(screen.getByText('Vượt hạn mức')).toBeInTheDocument();
    expect(screen.getByText('Trong mức')).toBeInTheDocument();
    expect(screen.getByText(/Đã dùng 106.7%/)).toBeInTheDocument();
    expect(screen.getByText(/đã qua 20\/31 ngày · còn 11 ngày/)).toBeInTheDocument();
    expect(screen.getAllByText(/Mức chi tuyến tính đến hôm nay:/).length).toBe(2);
    expect(screen.getByText(/1\.290\.323/)).toBeInTheDocument();
    expect(screen.getByText(/Hạn mức đã được sử dụng hết hoặc vượt/)).toBeInTheDocument();
    expect(screen.getByText(/hạn mức sẽ hết vào khoảng 27\/01\/2025/)).toBeInTheDocument();
    expect(screen.getByText(/ngoại suy tuyến tính/)).toBeInTheDocument();
    expect(screen.getByText(/hạn mức được đọc theo VND/)).toBeInTheDocument();
  });

  it('explains why there is no exhaustion date in each case', () => {
    renderPanel([
      item({
        id: 'ended',
        name: 'Đã kết thúc',
        status: 'COMPLETED',
        exhaustionProjection: 'period_ended',
      }),
      item({
        id: 'none',
        name: 'Chưa chi',
        status: 'ON_TRACK',
        spent: '0.00',
        remaining: '3000000.00',
        usagePercent: 0,
        exhaustionProjection: 'no_spending',
      }),
      item({
        id: 'future',
        name: 'Tháng sau',
        status: 'NOT_STARTED',
        daysElapsed: 0,
        daysRemaining: 31,
        expectedSpend: null,
        variance: null,
        pacePercent: null,
        dailySpendingAverage: null,
        exhaustionProjection: 'not_started',
      }),
      item({
        id: 'slow',
        name: 'Chi chậm',
        status: 'ON_TRACK',
        exhaustionProjection: 'beyond_period',
      }),
    ]);

    expect(screen.getByText('Đã kết thúc kỳ')).toBeInTheDocument();
    expect(screen.getByText('Chưa bắt đầu')).toBeInTheDocument();
    expect(screen.getByText(/Kỳ ngân sách đã kết thúc; không ngoại suy thêm/)).toBeInTheDocument();
    expect(
      screen.getByText(/Chưa có chi tiêu nên chưa thể ước tính ngày dùng hết hạn mức/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Kỳ ngân sách chưa bắt đầu/)).toBeInTheDocument();
    expect(screen.getByText(/hạn mức sẽ không hết trong kỳ/)).toBeInTheDocument();
  });

  it('links to budget creation when the month has no budgets', () => {
    renderPanel([]);
    expect(screen.getByText('Chưa có ngân sách cho tháng 01/2025')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tạo ngân sách' })).toHaveAttribute('href', '/budgets');
  });
});
