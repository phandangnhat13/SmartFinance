import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SpendingAlertDto, SpendingAlertStatus } from '@smart-finance/shared-types';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import type { AiChatContext } from '../lib/ai-chat-context';
import {
  ALERT_SEVERITY_LABELS,
  ALERT_SEVERITY_TONES,
  ALERT_STATUS_ACTIONS,
  ALERT_STATUS_LABELS,
  ALERT_STATUS_TONES,
  ALERT_TYPE_LABELS,
  factBoolean,
  factNumber,
  factRecord,
  factRecordArray,
  factString,
  formatAmountValue,
  formatCalendarDate,
  formatDecimal,
  formatMonthLabel,
  formatRatioValue,
  isRecord,
  resolveCurrency,
  toFiniteNumber,
} from '../lib/alerts';
import { alertsDetection, alertsSeverity } from '../lib/explanations';
import { formatDateTime } from '../lib/format';
import { AskAIAction, ExplainButton } from './Explain';
import { Badge, ErrorAlert } from './ui';

interface AlertDetailProps {
  alert: SpendingAlertDto;
  timezone: string;
  fallbackCurrency: string;
  onUpdated: (alert: SpendingAlertDto) => void;
  /** Called before opening the AI widget so the host modal can close first. */
  onClose?: () => void;
}

interface FactRow {
  label: string;
  value: ReactNode;
}

function FactList({ rows }: { rows: FactRow[] }) {
  const visible = rows.filter((row) => row.value !== null && row.value !== undefined);
  if (visible.length === 0) return null;
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {visible.map((row) => (
        <div key={row.label} className="rounded-xl bg-surface-muted px-3 py-2">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">{row.label}</dt>
          <dd className="mt-0.5 text-sm font-medium text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold text-ink">{children}</h3>;
}

function LargeTransactionFacts({
  alert,
  facts,
  currency,
}: {
  alert: SpendingAlertDto;
  facts: Record<string, unknown>;
  currency: string;
}) {
  const method = factString(facts, 'method');
  const clamped = factBoolean(facts, 'scoreClamped') === true;
  const exactZ = factNumber(facts, 'robustZ');
  const storedScore = toFiniteNumber(alert.score);
  // A clamped `score` is the column's ceiling, never the real z-score. The
  // exact value lives in `facts.robustZ`; older alerts may only have `score`,
  // which is used as-is unless it was flagged as clamped.
  const zValue = clamped ? exactZ : (exactZ ?? storedScore);
  const thresholds = factRecord(facts, 'thresholds') ?? {};

  return (
    <div className="space-y-3">
      <SectionTitle>Các số liệu đã dùng</SectionTitle>
      <FactList
        rows={[
          {
            label: 'Cách tính',
            value:
              method === 'mad_zero_ratio'
                ? 'Quy tắc tỷ lệ (MAD = 0)'
                : method === 'robust_z'
                  ? 'Độ lệch vững (robust z-score)'
                  : null,
          },
          { label: 'Số tiền', value: formatAmountValue(facts.amount, currency) },
          { label: 'Trung vị chi tiêu', value: formatAmountValue(facts.median, currency) },
          { label: 'MAD', value: formatAmountValue(facts.mad, currency) },
          { label: 'Tỷ lệ so với trung vị', value: formatRatioValue(facts.ratio) },
          {
            label: 'Lịch sử',
            value:
              factNumber(facts, 'historyCount') !== null
                ? `${factNumber(facts, 'historyCount')} giao dịch trong ${factNumber(facts, 'historyDays') ?? '—'} ngày`
                : null,
          },
          {
            label: 'Độ lệch vững',
            value:
              zValue !== null
                ? formatDecimal(zValue)
                : clamped
                  ? 'Không có giá trị thực tế trong dữ liệu'
                  : method === 'mad_zero_ratio'
                    ? 'Không tính được vì MAD = 0'
                    : null,
          },
          {
            label: 'Ngưỡng độ lệch vững',
            value: factNumber(thresholds, 'robustZ'),
          },
          {
            label: 'Ngưỡng tỷ lệ khi MAD = 0',
            value: factNumber(thresholds, 'madZeroRatio'),
          },
          {
            label: 'Tối thiểu giao dịch lịch sử',
            value: factNumber(thresholds, 'minHistoryCount'),
          },
        ]}
      />
      {clamped ? (
        <p className="rounded-xl border border-warning-border bg-warning-soft p-3 text-xs text-warning-strong">
          Điểm số lưu trong cơ sở dữ liệu đã chạm giới hạn của cột số và bị cắt bớt. Độ lệch vững
          hiển thị ở trên là giá trị thực tế tính từ dữ liệu, không bị cắt.
        </p>
      ) : null}
      <p className="text-xs text-ink-muted">
        Độ lệch vững cho biết khoản chi cách mức thường lệ bao nhiêu lần độ lệch; đây không phải xác
        suất.
      </p>
    </div>
  );
}

function CategorySpikeFacts({
  alert,
  facts,
  currency,
}: {
  alert: SpendingAlertDto;
  facts: Record<string, unknown>;
  currency: string;
}) {
  const thresholds = factRecord(facts, 'thresholds') ?? {};
  const references = factRecordArray(facts, 'referenceMonths');
  const excluded = factRecordArray(facts, 'excludedReferenceMonths');

  return (
    <div className="space-y-3">
      <SectionTitle>Các số liệu đã dùng</SectionTitle>
      <FactList
        rows={[
          {
            label: 'Danh mục',
            value: factString(facts, 'categoryName') ?? alert.categoryName,
          },
          { label: 'Tháng hiện tại', value: formatMonthLabel(factString(facts, 'currentMonth')) },
          { label: 'Số ngày đã xét', value: factNumber(facts, 'windowDays') },
          {
            label: 'Chi tiêu tháng này',
            value: formatAmountValue(facts.currentSpend, currency),
          },
          {
            label: 'Số giao dịch tháng này',
            value: factNumber(facts, 'currentTransactions'),
          },
          { label: 'Mức chi tham chiếu', value: formatAmountValue(facts.baseline, currency) },
          { label: 'Tỷ lệ so với tham chiếu', value: formatRatioValue(facts.ratio) },
          { label: 'Ngưỡng tỷ lệ', value: factNumber(thresholds, 'ratio') },
          {
            label: 'Tối thiểu tháng tham chiếu',
            value: factNumber(thresholds, 'minReferenceMonths'),
          },
          {
            label: 'Tối thiểu giao dịch tháng này',
            value: factNumber(thresholds, 'minCurrentTransactions'),
          },
        ]}
      />

      {references.length > 0 ? (
        <div>
          <SectionTitle>Các tháng tham chiếu</SectionTitle>
          <ul className="mt-2 space-y-1 text-sm text-ink-secondary">
            {references.map((reference, index) => {
              const spend = formatAmountValue(reference.spend, currency);
              const count = factNumber(reference, 'transactions');
              return (
                <li key={`${factString(reference, 'month') ?? 'month'}-${index}`}>
                  {formatMonthLabel(factString(reference, 'month'))}
                  {spend ? `: ${spend}` : ''}
                  {count !== null ? ` · ${count} giao dịch` : ''}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {excluded.length > 0 ? (
        <div>
          <SectionTitle>Tháng bị loại khỏi tham chiếu</SectionTitle>
          <ul className="mt-2 space-y-1 text-sm text-ink-secondary">
            {excluded.map((reference, index) => (
              <li key={`${factString(reference, 'month') ?? 'excluded'}-${index}`}>
                {formatMonthLabel(factString(reference, 'month'))}
                {factString(reference, 'reason') === 'no_data' ? ' · không có dữ liệu' : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function DuplicateFacts({
  alert,
  facts,
  currency,
  timezone,
}: {
  alert: SpendingAlertDto;
  facts: Record<string, unknown>;
  currency: string;
  timezone: string;
}) {
  const similar = factBoolean(facts, 'descriptionSimilar');
  const occurredAt = factString(facts, 'occurredAt');
  const relatedOccurredAt = factString(facts, 'relatedOccurredAt');
  const note = factString(facts, 'note');

  return (
    <div className="space-y-3">
      <SectionTitle>Các số liệu đã dùng</SectionTitle>
      <FactList
        rows={[
          { label: 'Số tiền', value: formatAmountValue(facts.amount, currency) },
          {
            label: 'Cách nhau',
            value:
              factNumber(facts, 'minutesApart') !== null
                ? `${factNumber(facts, 'minutesApart')} phút`
                : null,
          },
          {
            label: 'Mô tả giống nhau',
            value: similar === null ? null : similar ? 'Có' : 'Không',
          },
          {
            label: 'Khoảng thời gian so sánh',
            value:
              factNumber(facts, 'windowMinutes') !== null
                ? `${factNumber(facts, 'windowMinutes')} phút`
                : null,
          },
          { label: 'Tài khoản', value: factString(facts, 'accountId') },
        ]}
      />

      {alert.transactionId || alert.relatedTransactionId ? (
        <div className="rounded-xl border border-line p-3">
          <SectionTitle>Hai giao dịch bị nghi trùng</SectionTitle>
          <ul className="mt-2 space-y-1 text-sm text-ink-secondary">
            <li>
              <span className="font-medium">Giao dịch chính:</span>{' '}
              {occurredAt ? formatDateTime(occurredAt, timezone) : '—'}
              {alert.transactionId ? (
                <span className="ml-2 break-all font-mono text-xs text-ink-muted">
                  {alert.transactionId}
                </span>
              ) : null}
            </li>
            <li>
              <span className="font-medium">Giao dịch liên quan:</span>{' '}
              {relatedOccurredAt ? formatDateTime(relatedOccurredAt, timezone) : '—'}
              {alert.relatedTransactionId ? (
                <span className="ml-2 break-all font-mono text-xs text-ink-muted">
                  {alert.relatedTransactionId}
                </span>
              ) : null}
            </li>
          </ul>
        </div>
      ) : null}

      {note ? <p className="text-xs text-ink-muted">{note}</p> : null}
    </div>
  );
}

export function AlertDetail({
  alert,
  timezone,
  fallbackCurrency,
  onUpdated,
  onClose,
}: AlertDetailProps) {
  const queryClient = useQueryClient();
  const facts = isRecord(alert.facts) ? alert.facts : {};
  const currency = resolveCurrency(facts, fallbackCurrency);
  const actions = ALERT_STATUS_ACTIONS[alert.status] ?? [];
  // Only the alert's own labels and normalized evidence keys travel with the
  // AI request; transaction and account identifiers stay on this page.
  const context: AiChatContext = {
    page: 'alerts',
    feature: `alert-${alert.type.toLowerCase()}`,
    label: ALERT_TYPE_LABELS[alert.type],
    currency,
    ...(alert.periodStart && alert.periodEnd
      ? { dateRange: { from: alert.periodStart, to: alert.periodEnd } }
      : {}),
    evidenceKeys: Object.keys(facts).sort().slice(0, 6),
  };

  const updateStatus = useMutation({
    mutationFn: (status: SpendingAlertStatus) =>
      api.patch<{ alert: SpendingAlertDto }>(`/alerts/${alert.id}/status`, { status }),
    onSuccess: async (data) => {
      onUpdated(data.alert);
      await queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="sky">{ALERT_TYPE_LABELS[alert.type]}</Badge>
        <Badge tone={ALERT_SEVERITY_TONES[alert.severity]}>
          {`Mức độ: ${ALERT_SEVERITY_LABELS[alert.severity]}`}
        </Badge>
        <Badge tone={ALERT_STATUS_TONES[alert.status]}>
          {`Trạng thái: ${ALERT_STATUS_LABELS[alert.status]}`}
        </Badge>
        <ExplainButton
          explanation={alertsSeverity}
          label="Mức độ"
          variant="link"
          context={{ ...context, feature: 'alert-severity', label: 'Mức độ cảnh báo' }}
        />
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">Vì sao có cảnh báo này</h3>
          <ExplainButton
            explanation={alertsDetection}
            label="Cách phát hiện"
            variant="link"
            context={{ ...context, feature: 'alert-detection', label: 'Cách phát hiện' }}
          />
          <AskAIAction
            prompt="Giải thích cảnh báo chi tiêu này: vì sao hệ thống phát hiện và tôi nên kiểm tra gì."
            assistantType="ANALYTICS"
            context={context}
            label="Hỏi AI về cảnh báo này"
            onBeforeOpen={() => onClose?.()}
          />
        </div>
        <p className="mt-1 break-words text-sm leading-relaxed text-ink-secondary">
          {alert.explanation}
        </p>
        {alert.transactionId || alert.relatedTransactionId ? (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {alert.transactionId ? (
              <Link
                to={`/transactions/${alert.transactionId}/edit`}
                className="font-medium text-brand hover:underline"
              >
                Xem giao dịch chính
              </Link>
            ) : null}
            {alert.relatedTransactionId ? (
              <Link
                to={`/transactions/${alert.relatedTransactionId}/edit`}
                className="font-medium text-brand hover:underline"
              >
                Xem giao dịch liên quan
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      <FactList
        rows={[
          { label: 'Phát hiện lúc', value: formatDateTime(alert.createdAt, timezone) },
          { label: 'Danh mục', value: alert.categoryName },
          {
            label: 'Kỳ',
            value: alert.periodStart
              ? `${formatCalendarDate(alert.periodStart)} – ${formatCalendarDate(alert.periodEnd)}`
              : null,
          },
        ]}
      />

      {alert.type === 'LARGE_TRANSACTION' ? (
        <LargeTransactionFacts alert={alert} facts={facts} currency={currency} />
      ) : null}
      {alert.type === 'CATEGORY_SPIKE' ? (
        <CategorySpikeFacts alert={alert} facts={facts} currency={currency} />
      ) : null}
      {alert.type === 'POSSIBLE_DUPLICATE' ? (
        <DuplicateFacts alert={alert} facts={facts} currency={currency} timezone={timezone} />
      ) : null}

      <div className="rounded-xl border border-line bg-surface-muted p-4">
        <SectionTitle>Xử lý cảnh báo</SectionTitle>
        <p className="mt-1 text-xs text-ink-muted">
          Cảnh báo chỉ là gợi ý từ dữ liệu của bạn. “Đã xem” không có nghĩa là bạn xác nhận có gian
          lận; “Đánh dấu bình thường” nghĩa là khoản chi này bình thường với bạn.
        </p>
        {updateStatus.isError ? (
          <div className="mt-3">
            <ErrorAlert message={errorMessage(updateStatus.error)} />
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((action) => {
            const pending = updateStatus.isPending && updateStatus.variables === action.status;
            return (
              <button
                key={action.status}
                type="button"
                className={action.tone === 'primary' ? 'btn-primary' : 'btn-secondary'}
                disabled={updateStatus.isPending}
                onClick={() => updateStatus.mutate(action.status)}
              >
                {pending ? 'Đang cập nhật...' : action.label}
              </button>
            );
          })}
        </div>
        <ul className="mt-3 space-y-1 text-xs text-ink-muted">
          {actions.map((action) => (
            <li key={action.status}>
              <span className="font-medium text-ink-secondary">{action.label}:</span>{' '}
              {action.description}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
