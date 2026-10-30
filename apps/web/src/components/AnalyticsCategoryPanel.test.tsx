import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnalyticsCategoriesDto } from '@smart-finance/shared-types';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsCategoryPanel } from './AnalyticsCategoryPanel';

vi.mock('recharts', () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Container,
    LineChart: Container,
    Line: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

function makeData(overrides: Partial<AnalyticsCategoriesDto> = {}): AnalyticsCategoriesDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    type: 'EXPENSE',
    estimated: false,
    period: {
      kind: 'month',
      label: '2025-01',
      from: '2025-01-01',
      to: '2025-01-31',
      status: 'complete',
    },
    previousPeriod: {
      kind: 'month',
      label: '2024-12',
      from: '2024-12-01',
      to: '2024-12-31',
      status: 'complete',
    },
    total: '2000000.00',
    previousTotal: '1500000.00',
    hasTransactions: true,
    monthsInPeriod: 1,
    notableIncreasePercent: 25,
    categories: [
      {
        categoryId: 'food',
        categoryName: 'Ăn uống',
        isArchived: false,
        total: '2000000.00',
        transactionCount: 3,
        sharePercent: 100,
        averageMonthly: '2000000.00',
        previousTotal: '1000000.00',
        changeAmount: '1000000.00',
        changePercent: 100,
        direction: 'increase',
        notableIncrease: true,
        isNew: false,
        isRemoved: false,
        rank: 1,
      },
      {
        categoryId: 'new',
        categoryName: 'Cà phê',
        isArchived: false,
        total: '0.00',
        transactionCount: 0,
        sharePercent: 0,
        averageMonthly: '0.00',
        previousTotal: '500000.00',
        changeAmount: '-500000.00',
        changePercent: -100,
        direction: 'removed',
        notableIncrease: false,
        isNew: false,
        isRemoved: true,
        rank: null,
      },
    ],
    trend: null,
    ...overrides,
  };
}

describe('AnalyticsCategoryPanel', () => {
  it('prints API totals, shares and the change badges', () => {
    render(
      <AnalyticsCategoryPanel
        data={makeData()}
        currency="VND"
        selectedCategoryId=""
        onSelectCategory={vi.fn()}
      />,
    );

    expect(screen.getByText('Phân tích theo danh mục')).toBeInTheDocument();
    expect(screen.getAllByText(/2\.000\.000/).length).toBeGreaterThan(0);
    expect(screen.getByText(/100\.0% tổng chi tiêu · 3 giao dịch/)).toBeInTheDocument();
    expect(screen.getByText('Tăng ≥ 25%')).toBeInTheDocument();
    expect(screen.getByText('Không còn')).toBeInTheDocument();
    expect(screen.getByText(/hai danh mục trùng tên vẫn được tính riêng/)).toBeInTheDocument();
    expect(screen.getByText(/Ngưỡng “tăng đáng chú ý” là 25%/)).toBeInTheDocument();
  });

  it('asks the user to choose a category when no trend has been requested', () => {
    render(
      <AnalyticsCategoryPanel
        data={makeData()}
        currency="VND"
        selectedCategoryId=""
        onSelectCategory={vi.fn()}
      />,
    );
    expect(screen.getByText('Chọn một danh mục để xem chuỗi theo tháng.')).toBeInTheDocument();
  });

  it('reports an empty period instead of rendering zero rows', () => {
    render(
      <AnalyticsCategoryPanel
        data={makeData({
          total: '0.00',
          previousTotal: '0.00',
          categories: [],
          hasTransactions: false,
        })}
        currency="VND"
        selectedCategoryId=""
        onSelectCategory={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Không có giao dịch chi tiêu nào trong kỳ 2025-01.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Danh mục xem xu hướng')).not.toBeInTheDocument();
  });

  it('notifies the page when another category is selected', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <AnalyticsCategoryPanel
        data={makeData()}
        currency="VND"
        selectedCategoryId=""
        onSelectCategory={onSelect}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Danh mục xem xu hướng'), 'food');
    expect(onSelect).toHaveBeenCalledWith('food');
  });

  it('renders the trend series and its no-interpolation note', () => {
    render(
      <AnalyticsCategoryPanel
        data={makeData({
          trend: {
            categoryId: 'food',
            categoryName: 'Ăn uống',
            rangeMonths: 2,
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
          },
        })}
        currency="VND"
        selectedCategoryId="food"
        onSelectCategory={vi.fn()}
      />,
    );

    expect(screen.getByText(/2 tháng gần nhất của danh mục đã chọn/)).toBeInTheDocument();
    expect(
      screen.getByText(/Tháng không có giao dịch của danh mục được để trống/),
    ).toBeInTheDocument();
  });
});
