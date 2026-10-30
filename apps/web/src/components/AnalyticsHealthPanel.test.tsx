import { render, screen, within } from '@testing-library/react';
import type {
  FinancialHealthDto,
  FinancialHealthHistoryDto,
  HealthGroupDto,
  HealthRecommendationDto,
} from '@smart-finance/shared-types';
import { describe, expect, it } from 'vitest';
import { AnalyticsHealthPanel } from './AnalyticsHealthPanel';

function group(overrides: Partial<HealthGroupDto> = {}): HealthGroupDto {
  return {
    key: 'cash-flow',
    label: 'Sức khỏe dòng tiền',
    weight: 25,
    status: 'scored',
    score: 100,
    classification: 'EXCELLENT',
    contribution: 25,
    explanation: 'Tỷ lệ tiết kiệm 30% trên 6 tháng có dữ liệu.',
    evidence: [
      {
        key: 'savings_rate',
        label: 'Tỷ lệ tiết kiệm',
        value: '30%',
        reference: 'Mốc tham chiếu 20%',
      },
    ],
    missingData: [],
    limitations: ['Chỉ tính giao dịch thu và chi.'],
    ...overrides,
  };
}

function recommendation(overrides: Partial<HealthRecommendationDto> = {}): HealthRecommendationDto {
  return {
    id: 'cash-flow-savings-rate',
    group: 'cash-flow',
    severity: 'high',
    title: 'Tăng tỷ lệ tiết kiệm lên 20%',
    detail: 'Tỷ lệ tiết kiệm hiện tại là 5%.',
    evidence: ['Tỷ lệ tiết kiệm 5%'],
    impact: 'Cần thêm khoảng 1.500.000 VND mỗi tháng.',
    confidence: 'high',
    limitations: ['Mục tiêu dựa trên thu nhập trung bình quá khứ.'],
    module: 'transactions',
    requiresConfirmation: true,
    ...overrides,
  };
}

function health(overrides: Partial<FinancialHealthDto> = {}): FinancialHealthDto {
  const groups = [
    group(),
    group({
      key: 'budget',
      label: 'Quản lý ngân sách',
      weight: 20,
      score: 80,
      classification: 'GOOD',
      contribution: 16,
      explanation: '1 ngân sách gần hạn mức.',
    }),
    group({
      key: 'savings',
      label: 'Sức khỏe tiết kiệm',
      weight: 20,
      score: null,
      classification: 'INSUFFICIENT_DATA',
      contribution: null,
      status: 'insufficient_data',
      explanation: 'Chưa có mục tiêu tiết kiệm nào.',
      evidence: [],
      missingData: ['Tạo ít nhất một mục tiêu tiết kiệm.'],
    }),
  ];
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    asOf: '2026-10-30',
    generatedAt: '2026-10-30T03:00:00.000Z',
    estimated: true,
    formula: 'Điểm tổng = Σ(điểm nhóm × trọng số) ÷ Σ(trọng số của các nhóm có dữ liệu).',
    scoringRules: ['Dòng tiền: tỷ lệ tiết kiệm 30% được 50 điểm.'],
    dataQuality: {
      level: 'good',
      monthsWithData: 6,
      completeMonthsConsidered: 12,
      transactionCount: 12,
      scoredGroups: 2,
      totalGroups: 3,
    },
    assumptions: ['Chỉ dùng dữ liệu người dùng đã ghi.'],
    limitations: ['Không có dữ liệu tài sản hoặc khoản nợ ngoài hệ thống.'],
    overall: {
      status: 'scored',
      score: 95,
      classification: 'EXCELLENT',
      availableWeight: 45,
      totalWeight: 100,
      weightedScore: 95,
      explanation: 'Điểm tổng 95/100 trên 45% trọng số khả dụng.',
    },
    groups,
    recommendations: [recommendation()],
    historyAvailable: false,
    ...overrides,
  };
}

function history(overrides: Partial<FinancialHealthHistoryDto> = {}): FinancialHealthHistoryDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    asOf: '2026-10-30',
    generatedAt: '2026-10-30T03:00:00.000Z',
    method: 'recomputed',
    months: [
      {
        month: '2026-09',
        income: '10000000.00',
        expense: '7000000.00',
        net: '3000000.00',
        savingsRate: 30,
        hasTransactions: true,
        cashFlow: group(),
        budget: group({ key: 'budget', label: 'Quản lý ngân sách', weight: 20, score: 100 }),
      },
    ],
    availableGroups: ['cash-flow', 'budget'],
    overall: null,
    limitations: ['Chỉ nhóm Dòng tiền và Ngân sách tái tạo được cho từng tháng.'],
    ...overrides,
  };
}

describe('AnalyticsHealthPanel', () => {
  it('shows the score, classification, weights and the public formula', () => {
    render(<AnalyticsHealthPanel data={health()} history={history()} />);

    const panel = screen.getByRole('region', { name: 'Sức khỏe tài chính' });
    expect(within(panel).getByText('95')).toBeInTheDocument();
    expect(within(panel).getAllByText('Xuất sắc').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText(/45% trọng số khả dụng/).length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('Sức khỏe dòng tiền').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('Tỷ lệ tiết kiệm').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText(/^30%/).length).toBeGreaterThan(0);
    expect(within(panel).getByText(/Điểm tổng = /)).toBeInTheDocument();
    expect(within(panel).getByText(/tỷ lệ tiết kiệm 30% được 50 điểm/)).toBeInTheDocument();
  });

  it('states plainly that this is not a credit score and has no gauge', () => {
    render(<AnalyticsHealthPanel data={health()} history={history()} />);
    expect(screen.getByRole('note')).toHaveTextContent(/không phải điểm tín dụng/);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('renders recommendations as suggestions with impact and confirmation', () => {
    render(<AnalyticsHealthPanel data={health()} history={history()} />);
    const card = screen.getByLabelText('Gợi ý: Tăng tỷ lệ tiết kiệm lên 20%');
    expect(within(card).getByText('Ưu tiên cao')).toBeInTheDocument();
    expect(within(card).getByText(/1\.500\.000 VND/)).toBeInTheDocument();
    expect(within(card).getByText(/Giao dịch/)).toBeInTheDocument();
    expect(within(card).getByText(/không tự thay đổi giao dịch/)).toBeInTheDocument();
  });

  it('withholds the total and never shows a missing group as zero', () => {
    const data = health({
      overall: {
        status: 'insufficient_data',
        score: null,
        classification: 'INSUFFICIENT_DATA',
        availableWeight: 40,
        totalWeight: 100,
        weightedScore: null,
        explanation:
          'Chưa tính điểm tổng: cần ít nhất 3 nhóm có dữ liệu và 60% trọng số (hiện có 2 nhóm, 40%).',
      },
      recommendations: [],
    });
    render(<AnalyticsHealthPanel data={data} />);

    expect(screen.getByText('Chưa đủ dữ liệu để tính điểm tổng')).toBeInTheDocument();
    expect(screen.getByText(/hiện có 2 nhóm, 40%/)).toBeInTheDocument();
    const savings = screen.getByLabelText('Nhóm Sức khỏe tiết kiệm');
    expect(within(savings).getAllByText('Chưa đủ dữ liệu')).toHaveLength(2);
    expect(within(savings).queryByText('0/100')).not.toBeInTheDocument();
    expect(screen.getByText(/Không có gợi ý nào từ dữ liệu hiện tại/)).toBeInTheDocument();
    expect(screen.getByText(/Đang tải lịch sử điểm/)).toBeInTheDocument();
  });

  it('renders the recomputed history and its scope limitation', () => {
    render(<AnalyticsHealthPanel data={health()} history={history()} />);
    expect(screen.getByText('09/2026')).toBeInTheDocument();
    expect(screen.getByText(/chỉ tái tạo được nhóm Dòng tiền và Ngân sách/)).toBeInTheDocument();
    expect(
      screen.getByText(/Chỉ nhóm Dòng tiền và Ngân sách tái tạo được cho từng tháng/),
    ).toBeInTheDocument();
  });
});
