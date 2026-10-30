import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AlertScanSummaryDto,
  PaginatedDto,
  SpendingAlertDto,
  SpendingAlertStatus,
  SpendingAlertType,
} from '@smart-finance/shared-types';
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertDetail } from '../components/AlertDetail';
import { Badge, cn, EmptyState, ErrorAlert, Modal, PageHeader, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api, ApiError, errorMessage } from '../lib/api';
import {
  ALERT_SEVERITY_LABELS,
  ALERT_SEVERITY_TONES,
  ALERT_STATUS_LABELS,
  ALERT_STATUS_TONES,
  ALERT_TYPE_LABELS,
  formatCalendarDate,
  formatMonthLabel,
  normalizeCurrency,
} from '../lib/alerts';
import { formatDateTime } from '../lib/format';

const PAGE_SIZE = 20;
const ALERT_TYPES: SpendingAlertType[] = [
  'LARGE_TRANSACTION',
  'CATEGORY_SPIKE',
  'POSSIBLE_DUPLICATE',
];
const STATUS_OPTIONS: SpendingAlertStatus[] = [
  'OPEN',
  'ACKNOWLEDGED',
  'DISMISSED',
  'MARKED_NORMAL',
];

function scanFailureMessage(error: unknown): string {
  if (error instanceof ApiError && (error.status === 429 || error.code === 'RATE_LIMITED')) {
    return error.retryAfterSeconds
      ? `Bạn đã quét quá nhiều lần. Vui lòng thử lại sau ${error.retryAfterSeconds} giây.`
      : 'Bạn đã quét quá nhiều lần. Vui lòng thử lại sau ít phút.';
  }
  return errorMessage(error);
}

function ScanSummary({ summary }: { summary: AlertScanSummaryDto }) {
  const truncated = summary.status === 'truncated';
  const capNotes: string[] = [];
  if (summary.limits.transactionsTruncated) {
    capNotes.push(
      `Chỉ xét tối đa ${summary.limits.maxTransactions} giao dịch gần nhất; giao dịch cũ hơn chưa được quét.`,
    );
  }
  if (summary.limits.largeCandidatesCapped) {
    capNotes.push(`Chỉ phân tích tối đa ${summary.limits.maxLargeCandidates} khoản chi gần nhất.`);
  }
  if (summary.limits.duplicateCapReached) {
    capNotes.push(
      `Đã chạm giới hạn ${summary.limits.maxDuplicatePairs} cặp giao dịch có thể trùng.`,
    );
  }

  return (
    <section className="card mb-4" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">Kết quả quét</h2>
        <Badge tone={truncated ? 'amber' : 'emerald'}>
          {truncated ? 'Bị giới hạn' : 'Hoàn tất'}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Đã phát hiện {summary.detected} cảnh báo · Mới lưu {summary.created} · Đã có từ trước{' '}
        {summary.alreadyPresent}.
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
        {ALERT_TYPES.map((type) => (
          <li key={type}>
            {ALERT_TYPE_LABELS[type]}:{' '}
            <span className="font-semibold text-slate-800">
              {summary.detectedByType[type] ?? 0}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-slate-600">
        Đã xét {summary.scannedTransactions} giao dịch trong {summary.window.currentDays} ngày của
        tháng {formatMonthLabel(summary.window.currentMonth)}.
      </p>
      {truncated ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Lần quét này chưa đầy đủ.</p>
          <p className="mt-1">
            Một giới hạn xử lý đã bị chạm, nên chưa phải toàn bộ dữ liệu được kiểm tra:
          </p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {capNotes.length > 0 ? (
              capNotes.map((note) => <li key={note}>{note}</li>)
            ) : (
              <li>Dữ liệu vượt quá giới hạn xử lý của lần quét.</li>
            )}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function AlertsPage() {
  const { user } = useAuth();
  const timezone = user?.timezone ?? 'Asia/Ho_Chi_Minh';
  const fallbackCurrency = normalizeCurrency(user?.defaultCurrency);
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<SpendingAlertStatus | ''>('');
  const [type, setType] = useState<SpendingAlertType | ''>('');
  const [page, setPage] = useState(1);
  const [activeAlert, setActiveAlert] = useState<SpendingAlertDto | null>(null);
  const [scanSummary, setScanSummary] = useState<AlertScanSummaryDto | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (status) params.set('status', status);
  if (type) params.set('type', type);
  const queryKey = ['alerts', params.toString()] as const;

  const alertsQuery = useQuery({
    queryKey,
    queryFn: () => api.get<PaginatedDto<SpendingAlertDto>>(`/alerts?${params.toString()}`),
  });

  const scanMutation = useMutation({
    mutationFn: () => api.post<{ scan: AlertScanSummaryDto }>('/alerts/scan'),
    onSuccess: async (data) => {
      setScanError(null);
      setScanSummary(data.scan);
      await queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (error) => {
      setScanSummary(null);
      setScanError(scanFailureMessage(error));
    },
  });

  const result = alertsQuery.data;

  // A status change can empty the last page (for example when filtering by
  // "OPEN"); step back instead of showing an empty page that still claims to
  // have results.
  useEffect(() => {
    if (result && result.totalPages > 0 && page > result.totalPages) {
      setPage(result.totalPages);
    }
  }, [result, page]);

  function resetFilters() {
    setStatus('');
    setType('');
    setPage(1);
  }

  return (
    <div>
      <PageHeader
        title="Cảnh báo chi tiêu"
        description="Các khoản chi bất thường được phát hiện từ dữ liệu của bạn. Cảnh báo chỉ là gợi ý, không phải kết luận gian lận."
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
          >
            <RefreshCw
              className={cn('h-4 w-4', scanMutation.isPending && 'animate-spin')}
              aria-hidden
            />
            {scanMutation.isPending ? 'Đang quét...' : 'Quét chi tiêu'}
          </button>
        }
      />

      <div className="card mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="alertFilterStatus">
              Trạng thái
            </label>
            <select
              id="alertFilterStatus"
              className="input"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as SpendingAlertStatus | '');
                setPage(1);
              }}
            >
              <option value="">Tất cả</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {ALERT_STATUS_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="alertFilterType">
              Loại cảnh báo
            </label>
            <select
              id="alertFilterType"
              className="input"
              value={type}
              onChange={(event) => {
                setType(event.target.value as SpendingAlertType | '');
                setPage(1);
              }}
            >
              <option value="">Tất cả</option>
              {ALERT_TYPES.map((option) => (
                <option key={option} value={option}>
                  {ALERT_TYPE_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
            onClick={resetFilters}
          >
            Xoá bộ lọc
          </button>
        </div>
      </div>

      {scanError ? (
        <div className="mb-4">
          <ErrorAlert message={scanError} />
        </div>
      ) : null}

      {scanSummary ? <ScanSummary summary={scanSummary} /> : null}

      {alertsQuery.isLoading ? (
        <Spinner label="Đang tải cảnh báo..." />
      ) : alertsQuery.error ? (
        <ErrorAlert
          message={errorMessage(alertsQuery.error)}
          onRetry={() => void alertsQuery.refetch()}
        />
      ) : (result?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="Không có cảnh báo phù hợp"
          description="Thử đổi bộ lọc hoặc bấm “Quét chi tiêu” để kiểm tra dữ liệu mới."
          action={
            <button type="button" className="btn-secondary" onClick={resetFilters}>
              Xoá bộ lọc
            </button>
          }
        />
      ) : (
        <>
          <ul className="space-y-3">
            {result?.items.map((alert) => (
              <li key={alert.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">
                        {ALERT_TYPE_LABELS[alert.type]}
                      </span>
                      <Badge tone={ALERT_SEVERITY_TONES[alert.severity]}>
                        {`Mức độ: ${ALERT_SEVERITY_LABELS[alert.severity]}`}
                      </Badge>
                      <Badge tone={ALERT_STATUS_TONES[alert.status]}>
                        {`Trạng thái: ${ALERT_STATUS_LABELS[alert.status]}`}
                      </Badge>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-slate-600">{alert.explanation}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>Phát hiện: {formatDateTime(alert.createdAt, timezone)}</span>
                      {alert.categoryName ? <span>Danh mục: {alert.categoryName}</span> : null}
                      {alert.periodStart ? (
                        <span>
                          Kỳ: {formatCalendarDate(alert.periodStart)} –{' '}
                          {formatCalendarDate(alert.periodEnd)}
                        </span>
                      ) : null}
                      {alert.transactionId ? (
                        <Link
                          to={`/transactions/${alert.transactionId}/edit`}
                          className="font-medium text-emerald-700 hover:underline"
                        >
                          Xem giao dịch liên quan
                        </Link>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setActiveAlert(alert)}
                    aria-label={`Xem chi tiết: ${ALERT_TYPE_LABELS[alert.type]} phát hiện ${formatDateTime(
                      alert.createdAt,
                      timezone,
                    )}`}
                  >
                    Chi tiết
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
            <span>
              Trang {result?.page} / {Math.max(result?.totalPages ?? 1, 1)} · {result?.total ?? 0}{' '}
              cảnh báo
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary py-1.5"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Trước
              </button>
              <button
                type="button"
                className="btn-secondary py-1.5"
                disabled={page >= (result?.totalPages ?? 1)}
                onClick={() => setPage((value) => value + 1)}
              >
                Sau
              </button>
            </div>
          </div>
        </>
      )}

      <Modal
        open={activeAlert !== null}
        title="Chi tiết cảnh báo"
        onClose={() => setActiveAlert(null)}
      >
        {activeAlert ? (
          <AlertDetail
            alert={activeAlert}
            timezone={timezone}
            fallbackCurrency={fallbackCurrency}
            onUpdated={setActiveAlert}
          />
        ) : null}
      </Modal>
    </div>
  );
}
