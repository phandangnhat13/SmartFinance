import { render, screen, within } from '@testing-library/react';
import type { AnalyticsTrendsDto } from '@smart-finance/shared-types';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsTrendCharts } from './AnalyticsTrendCharts';

vi.mock('recharts', () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Container,
    LineChart: Container,
    BarChart: Container,
    Line: () => null,
    Bar: () => null,
    Cell: () => null,
    CartesianGrid: () => null,
    Legend: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

function makeTrends(overrides: Partial<AnalyticsTrendsDto> = {}): AnalyticsTrendsDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    rangeMonths: 3,
    estimated: false,
    points: [
      {
        month: '2024-11',
        monthStatus: 'complete',
        income: '0.00',
        expense: '0.00',
        net: '0.00',
        savingsRate: null,
        transactionCount: 0,
        hasTransactions: false,
      },
      {
        month: '2024-12',
        monthStatus: 'complete',
        income: '0.00',
        expense: '500000.00',
        net: '-500000.00',
        savingsRate: null,
        transactionCount: 1,
        hasTransactions: true,
      },
      {
        month: '2025-01',
        monthStatus: 'in_progress',
        income: '5000000.00',
        expense: '2300000.00',
        net: '2700000.00',
        savingsRate: 54,
        transactionCount: 3,
        hasTransactions: true,
      },
    ],
    ...overrides,
  };
}

function renderCharts(data = makeTrends()) {
  return render(
    <AnalyticsTrendCharts data={data} currency={data.currency} timezone={data.timezone} />,
  );
}

function rowFor(label: string): HTMLElement {
  const cell = screen.getByText(label, { selector: 'th' });
  const row = cell.closest('tr');
  if (!row) throw new Error(`No row for ${label}`);
  return row as HTMLElement;
}

describe('AnalyticsTrendCharts', () => {
  it('labels a month without transactions as "no data" instead of zero', () => {
    renderCharts();

    const emptyRow = rowFor('11/2024');
    expect(within(emptyRow).getByText('Không có dữ liệu')).toBeInTheDocument();
    expect(within(emptyRow).queryByText(/^0\s*₫$/)).not.toBeInTheDocument();
  });

  it('keeps a measured zero visible when the month does have transactions', () => {
    renderCharts();

    const zeroIncomeRow = rowFor('12/2024');
    expect(within(zeroIncomeRow).queryByText('Không có dữ liệu')).not.toBeInTheDocument();
    expect(within(zeroIncomeRow).getByText(/^0\s*₫$/)).toBeInTheDocument();
    expect(within(zeroIncomeRow).getByText(/-500\.000/)).toBeInTheDocument();
  });

  it('marks the ongoing month and prints the range in the chart captions', () => {
    renderCharts();

    expect(within(rowFor('01/2025')).getByText('(đang diễn ra)')).toBeInTheDocument();
    expect(screen.getByText(/3 tháng gần nhất, đơn vị VND/)).toBeInTheDocument();
    expect(screen.getByText(/múi giờ Asia\/Ho_Chi_Minh/)).toBeInTheDocument();
    expect(screen.getByText(/không nội suy/)).toBeInTheDocument();
  });

  it('explains that a whole window without transactions is empty', () => {
    renderCharts(
      makeTrends({
        points: makeTrends().points.map((point) => ({
          ...point,
          income: '0.00',
          expense: '0.00',
          net: '0.00',
          savingsRate: null,
          transactionCount: 0,
          hasTransactions: false,
        })),
      }),
    );

    expect(
      screen.getByText('Không có giao dịch thu hoặc chi trong khoảng này.'),
    ).toBeInTheDocument();
  });
});
