import { fireEvent, render, screen } from '@testing-library/react';
import type { AnalyticsForecastDto, ForecastSeriesDto } from '@smart-finance/shared-types';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsForecastPanel } from './AnalyticsForecastPanel';

vi.mock('recharts', () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Container,
    ComposedChart: Container,
    Bar: () => null,
    Line: () => null,
    CartesianGrid: () => null,
    Legend: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

function series(
  kind: 'income' | 'expense',
  overrides: Partial<ForecastSeriesDto> = {},
): ForecastSeriesDto {
  return {
    kind,
    status: 'ok',
    reason: null,
    model: 'historical_average',
    modelScores: [
      {
        model: 'historical_average',
        eligible: true,
        reason: null,
        origins: 2,
        mae: '0.00',
        wapePercent: 0,
      },
    ],
    selectedBecause: '2 kỳ kiểm chứng chéo, sai số thấp nhất.',
    confidence: { level: 'high', score: 90, basis: ['6 tháng có dữ liệu.'] },
    monthlyAverage: kind === 'income' ? '10000000.00' : '3000000.00',
    monthsWithData: 6,
    history: [
      {
        month: '2026-03',
        amount: kind === 'income' ? '10000000.00' : '3000000.00',
        hasTransactions: true,
      },
      {
        month: '2026-04',
        amount: kind === 'income' ? '10000000.00' : '3000000.00',
        hasTransactions: true,
      },
    ],
    months: [
      {
        month: '2026-10',
        amount: kind === 'income' ? '8000000.00' : '2000000.00',
        isPartial: true,
      },
    ],
    horizonTotal: kind === 'income' ? '8000000.00' : '2000000.00',
    ...overrides,
  };
}

function makeForecast(overrides: Partial<AnalyticsForecastDto> = {}): AnalyticsForecastDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    asOf: '2026-10-30',
    generatedAt: '2026-10-30T03:00:00.000Z',
    horizon: 'current_month',
    horizonMonths: ['2026-10'],
    status: 'ok',
    reason: null,
    income: series('income'),
    expense: series('expense'),
    categoryForecasts: [
      {
        categoryId: 'food',
        categoryName: 'Ăn uống',
        status: 'ok',
        reason: null,
        model: 'historical_average',
        confidence: 'high',
        monthsWithData: 6,
        monthlyAverage: '1500000.00',
        months: [{ month: '2026-10', amount: '1100000.00', isPartial: true }],
        horizonTotal: '1100000.00',
      },
    ],
    net: {
      status: 'ok',
      reason: null,
      model: 'historical_average',
      base: '6000000.00',
      best: '6000000.00',
      worst: '6000000.00',
      bandMethod: 'mae',
    },
    monthEndBalance: {
      status: 'ok',
      reason: null,
      currentBalance: '48200000.00',
      remainingIncome: '8000000.00',
      remainingExpense: '2000000.00',
      projectedBalance: '54200000.00',
      accountsIncluded: 3,
      accountsArchived: 1,
      transfersNetted: true,
    },
    dataQuality: {
      completeMonthsConsidered: 12,
      monthsWithData: 6,
      missingMonths: ['2025-10', '2025-11'],
      transactionCount: 25,
      continuityPercent: 50,
      level: 'limited',
    },
    assumptions: ['Không dùng AI/LLM và không tự tạo giao dịch.'],
    limitations: ['Không dự đoán được sự kiện bất thường.'],
    estimated: true,
    ...overrides,
  };
}

function renderPanel(
  data: AnalyticsForecastDto,
  onHorizonChange: (horizon: 'current_month' | '1m' | '3m' | '6m') => void = () => {},
) {
  return render(
    <AnalyticsForecastPanel
      data={data}
      currency="VND"
      horizon="current_month"
      onHorizonChange={onHorizonChange}
    />,
  );
}

describe('AnalyticsForecastPanel', () => {
  it('labels every figure as a forecast and shows model, confidence and balance math', () => {
    renderPanel(makeForecast());

    expect(screen.getByText('Giá trị dự báo, không phải số liệu thực tế')).toBeInTheDocument();
    expect(screen.getAllByText('Mô hình: Trung bình lịch sử').length).toBe(2);
    expect(screen.getAllByText('Tin cậy cao').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Điểm tin cậy 90\/100/).length).toBe(2);
    expect(screen.getAllByText(/2 kỳ kiểm chứng chéo, sai số thấp nhất/).length).toBe(2);
    expect(screen.getAllByText(/8\.000\.000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2\.000\.000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Còn lại của tháng').length).toBeGreaterThan(0);
    expect(screen.getByText('Ăn uống')).toBeInTheDocument();
    expect(
      screen.getByText(/6\/12 tháng đã kết thúc có dữ liệu \(50% liên tục\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/25 giao dịch thu\/chi/)).toBeInTheDocument();
    expect(screen.getByText(/Không dùng AI\/LLM và không tự tạo giao dịch/)).toBeInTheDocument();
    expect(screen.getByText(/Không dự đoán được sự kiện bất thường/)).toBeInTheDocument();
    expect(screen.getByText(/3 tài khoản \(gồm 1 tài khoản đã lưu trữ\)/)).toBeInTheDocument();
    expect(screen.getByText(/Đủ dữ liệu dự báo/)).toBeInTheDocument();
  });

  it('withholds numbers and explains why when data is insufficient', () => {
    renderPanel(
      makeForecast({
        status: 'insufficient_data',
        reason: 'too_few_months',
        income: series('income', {
          status: 'insufficient_data',
          reason: 'too_few_months',
          model: null,
          months: [],
          horizonTotal: null,
        }),
        expense: series('expense', {
          status: 'insufficient_data',
          reason: 'too_few_months',
          model: null,
          months: [],
          horizonTotal: null,
        }),
        categoryForecasts: [],
        net: {
          status: 'insufficient_data',
          reason: 'too_few_months',
          model: null,
          base: null,
          best: null,
          worst: null,
          bandMethod: null,
        },
        monthEndBalance: {
          status: 'insufficient_data',
          reason: 'missing_series',
          currentBalance: null,
          remainingIncome: null,
          remainingExpense: null,
          projectedBalance: null,
          accountsIncluded: 0,
          accountsArchived: 0,
          transfersNetted: true,
        },
      }),
    );

    expect(screen.getByText('Chưa thể dự báo')).toBeInTheDocument();
    expect(screen.getByText(/Cần ít nhất 3 tháng có giao dịch đã kết thúc/)).toBeInTheDocument();
    expect(screen.getByText('Chưa đủ dữ liệu')).toBeInTheDocument();
    expect(screen.getByText('Giá trị dự báo, không phải số liệu thực tế')).toBeInTheDocument();
    expect(screen.queryByText(/Số dư cuối tháng dự kiến/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Dòng tiền ròng dự báo/)).not.toBeInTheDocument();
  });

  it('lets the user change the forecast horizon', () => {
    const onHorizonChange = vi.fn();
    renderPanel(makeForecast(), onHorizonChange);

    fireEvent.change(screen.getByLabelText('Khoảng dự báo'), { target: { value: '3m' } });
    expect(onHorizonChange).toHaveBeenCalledWith('3m');
  });
});
