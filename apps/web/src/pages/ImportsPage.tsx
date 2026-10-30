import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ImportBatchDto,
  ImportPreviewDto,
  ImportRowStatus,
  ImportStatus,
} from '@smart-finance/shared-types';
import { CheckCircle2, Download, FileUp, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Badge, EmptyState, ErrorAlert, PageHeader, Spinner } from '../components/ui';
import { api, downloadFile, errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';

const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  UPLOADED: 'Đã tải lên',
  PREVIEW_READY: 'Chờ xác nhận',
  IMPORTING: 'Đang nhập',
  COMPLETED: 'Hoàn tất',
  FAILED: 'Thất bại',
};

const ROW_STATUS_LABELS: Record<ImportRowStatus, string> = {
  VALID: 'Hợp lệ',
  INVALID: 'Lỗi',
  IMPORTED: 'Đã nhập',
  SKIPPED_DUPLICATE: 'Trùng',
};

function statusTone(status: ImportStatus): 'emerald' | 'rose' | 'amber' | 'slate' | 'sky' {
  if (status === 'COMPLETED') return 'emerald';
  if (status === 'FAILED') return 'rose';
  if (status === 'PREVIEW_READY') return 'sky';
  if (status === 'IMPORTING') return 'amber';
  return 'slate';
}

function rowTone(status: ImportRowStatus): 'emerald' | 'rose' | 'amber' | 'slate' {
  if (status === 'VALID' || status === 'IMPORTED') return 'emerald';
  if (status === 'INVALID') return 'rose';
  if (status === 'SKIPPED_DUPLICATE') return 'amber';
  return 'slate';
}

export function ImportsPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const historyQuery = useQuery({
    queryKey: ['imports'],
    queryFn: () => api.get<{ items: ImportBatchDto[] }>('/imports'),
  });

  const uploadMutation = useMutation({
    mutationFn: (selected: File) => {
      const formData = new FormData();
      formData.append('file', selected);
      return api.upload<ImportPreviewDto>('/imports/csv', formData);
    },
    onSuccess: async (data) => {
      setPreview(data);
      setNotice(
        `Đã kiểm tra ${data.batch.totalRows} dòng: ${data.batch.validRows} hợp lệ, ${data.batch.invalidRows} lỗi, ${data.batch.duplicateRows} trùng.`,
      );
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await queryClient.invalidateQueries({ queryKey: ['imports'] });
    },
    onError: (uploadError) => setError(errorMessage(uploadError)),
  });

  const commitMutation = useMutation({
    mutationFn: (id: string) => api.post<{ batch: ImportBatchDto }>(`/imports/${id}/commit`),
    onSuccess: async (data) => {
      setPreview((current) => (current ? { ...current, batch: data.batch } : current));
      setNotice(
        `Đã nhập ${data.batch.importedRows} giao dịch. Bỏ qua ${data.batch.duplicateRows} dòng trùng.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['imports'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['analytics'] }),
        queryClient.invalidateQueries({ queryKey: ['accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['budgets'] }),
      ]);
    },
    onError: (commitError) => setError(errorMessage(commitError)),
  });

  const previewQuery = useMutation({
    mutationFn: (id: string) => api.get<ImportPreviewDto>(`/imports/${id}/preview`),
    onSuccess: (data) => {
      setPreview(data);
      setNotice(null);
      setError(null);
    },
    onError: (previewError) => setError(errorMessage(previewError)),
  });

  function handleUpload() {
    setError(null);
    setNotice(null);
    if (!file) {
      setError('Vui lòng chọn tệp CSV trước khi tải lên.');
      return;
    }
    uploadMutation.mutate(file);
  }

  async function handleDownloadTemplate() {
    setError(null);
    try {
      await downloadFile('/imports/template.csv', 'smart-finance-import-template.csv');
    } catch (downloadError) {
      setError(errorMessage(downloadError));
    }
  }

  const rows = preview?.rows ?? [];
  const canCommit = preview?.batch.status === 'PREVIEW_READY' && preview.batch.validRows > 0;

  return (
    <div>
      <PageHeader
        title="Nhập / xuất CSV"
        description="Tải CSV, xem trước từng dòng, xác nhận nhập và chống trùng lặp tự động."
        actions={
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void handleDownloadTemplate()}
          >
            <Download className="h-4 w-4" aria-hidden /> Tải template
          </button>
        }
      />

      {error ? (
        <div className="mb-4">
          <ErrorAlert message={error} />
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-xl border border-brand/30 bg-brand-soft p-4 text-sm text-brand-hover"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{notice}</span>
        </div>
      ) : null}

      <section className="card mb-6">
        <h2 className="font-semibold text-ink">1. Chọn tệp CSV</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Cột bắt buộc: account, type, amount, occurredAt, description. Cột tuỳ chọn: category,
          note, currency. Tối đa 2 MB. Tài khoản và danh mục phải tồn tại trước khi nhập.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label htmlFor="csvFile" className="sr-only">
            Tệp CSV
          </label>
          <input
            ref={fileInputRef}
            id="csvFile"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="block w-full max-w-md text-sm text-ink-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-brand-soft file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-hover hover:file:bg-brand-soft"
          />
          <button
            type="button"
            className="btn-primary"
            onClick={handleUpload}
            disabled={uploadMutation.isPending}
          >
            <Upload className="h-4 w-4" aria-hidden />
            {uploadMutation.isPending ? 'Đang kiểm tra...' : 'Tải lên và xem trước'}
          </button>
        </div>
      </section>

      {preview ? (
        <section className="card mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-ink">2. Xem trước: {preview.batch.fileName}</h2>
              <p className="mt-1 text-sm text-ink-secondary">
                {preview.batch.totalRows} dòng · {preview.batch.validRows} hợp lệ ·{' '}
                {preview.batch.invalidRows} lỗi · {preview.batch.duplicateRows} trùng
              </p>
            </div>
            <Badge tone={statusTone(preview.batch.status)}>
              {IMPORT_STATUS_LABELS[preview.batch.status]}
            </Badge>
          </div>

          <div className="mt-4 max-h-96 overflow-auto rounded-xl border border-line">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="sticky top-0 bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Dòng</th>
                  <th className="px-3 py-2 font-medium">Mô tả</th>
                  <th className="px-3 py-2 font-medium">Số tiền</th>
                  <th className="px-3 py-2 font-medium">Ngày</th>
                  <th className="px-3 py-2 font-medium">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((row) => (
                  <tr key={row.rowNumber} className="border-t border-line align-top">
                    <td className="px-3 py-2 text-ink-muted">{row.rowNumber}</td>
                    <td className="px-3 py-2">
                      <p className="text-ink">{row.rawData.description ?? '—'}</p>
                      {row.errors.length > 0 ? (
                        <ul className="mt-1 list-inside list-disc text-xs text-danger">
                          {row.errors.map((rowError) => (
                            <li key={rowError}>{rowError}</li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">
                      {row.rawData.amount ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">
                      {row.rawData.occurredAt ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={rowTone(row.status)}>{ROW_STATUS_LABELS[row.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 200 ? (
            <p className="mt-2 text-xs text-ink-muted">Chỉ hiển thị 200 dòng đầu tiên.</p>
          ) : null}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setPreview(null);
                setNotice(null);
              }}
            >
              Đóng
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!canCommit || commitMutation.isPending}
              onClick={() => preview && commitMutation.mutate(preview.batch.id)}
            >
              <FileUp className="h-4 w-4" aria-hidden />
              {commitMutation.isPending
                ? 'Đang nhập...'
                : preview.batch.status === 'COMPLETED'
                  ? 'Đã nhập'
                  : `Xác nhận nhập ${preview.batch.validRows} dòng`}
            </button>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2 className="mb-3 font-semibold text-ink">Lịch sử import</h2>
        {historyQuery.isLoading ? (
          <Spinner label="Đang tải lịch sử..." />
        ) : historyQuery.error ? (
          <ErrorAlert
            message={errorMessage(historyQuery.error)}
            onRetry={() => void historyQuery.refetch()}
          />
        ) : (historyQuery.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="Chưa có lần import nào"
            description="Tải lên tệp CSV đầu tiên để bắt đầu."
          />
        ) : (
          <ul className="divide-y divide-line">
            {historyQuery.data?.items.map((batch) => (
              <li key={batch.id}>
                <button
                  type="button"
                  onClick={() => previewQuery.mutate(batch.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left hover:bg-surface-muted"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">{batch.fileName}</p>
                    <p className="text-xs text-ink-muted">
                      {formatDateTime(batch.createdAt)} · {batch.totalRows} dòng · đã nhập{' '}
                      {batch.importedRows}
                    </p>
                  </div>
                  <Badge tone={statusTone(batch.status)}>
                    {IMPORT_STATUS_LABELS[batch.status]}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
        {previewQuery.isPending ? <Spinner label="Đang mở bản xem trước..." /> : null}
      </section>
    </div>
  );
}
