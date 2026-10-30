import type {
  FinancialHealthDto,
  FinancialHealthHistoryDto,
  HealthClassification,
  HealthGroupDto,
  HealthRecommendationDto,
  HealthRecommendationSeverity,
} from '@smart-finance/shared-types';
import { HEALTH_CLASSIFICATION_LABELS } from '@smart-finance/shared-types';
import { Info } from 'lucide-react';
import { formatDateTime, formatMonthLabel } from '../lib/format';
import { Badge, EmptyState } from './ui';

type Tone = 'emerald' | 'amber' | 'rose' | 'slate' | 'sky';

const CLASSIFICATION_META: Record<HealthClassification, { tone: Tone }> = {
  EXCELLENT: { tone: 'emerald' },
  GOOD: { tone: 'sky' },
  FAIR: { tone: 'amber' },
  NEEDS_ATTENTION: { tone: 'rose' },
  INSUFFICIENT_DATA: { tone: 'slate' },
};

const SEVERITY_META: Record<HealthRecommendationSeverity, { label: string; tone: Tone }> = {
  high: { label: 'Ưu tiên cao', tone: 'rose' },
  medium: { label: 'Ưu tiên trung bình', tone: 'amber' },
  low: { label: 'Ưu tiên thấp', tone: 'slate' },
};

const MODULE_LABELS: Record<HealthRecommendationDto['module'], string> = {
  transactions: 'Giao dịch',
  budgets: 'Ngân sách',
  savings: 'Tiết kiệm',
  accounts: 'Tài khoản',
  'analytics-forecast': 'Dự báo',
};

function classificationBadge(classification: HealthClassification) {
  return (
    <Badge tone={CLASSIFICATION_META[classification].tone}>
      {HEALTH_CLASSIFICATION_LABELS[classification]}
    </Badge>
  );
}

function GroupCard({ group }: { group: HealthGroupDto }) {
  return (
    <div className="rounded-xl border border-line p-3" aria-label={`Nhóm ${group.label}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-ink">{group.label}</p>
          <p className="text-xs text-ink-muted">Trọng số {group.weight}%</p>
        </div>
        {classificationBadge(group.classification)}
      </div>
      <p className="mt-2 text-xl font-bold tracking-tight text-ink">
        {group.status === 'scored' && group.score !== null
          ? `${group.score}/100`
          : 'Chưa đủ dữ liệu'}
      </p>
      <p className="mt-1 text-sm text-ink-secondary">{group.explanation}</p>

      {group.evidence.length > 0 ? (
        <dl className="mt-2 space-y-1 text-xs text-ink-secondary">
          {group.evidence.map((item) => (
            <div key={item.key} className="flex flex-wrap justify-between gap-2">
              <dt className="text-ink-muted">{item.label}</dt>
              <dd className="font-medium text-ink-secondary">
                {item.value}
                {item.reference ? (
                  <span className="ml-1 font-normal text-ink-muted">({item.reference})</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {group.missingData.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-warning-strong">
          {group.missingData.map((line) => (
            <li key={line}>Thiếu dữ liệu: {line}</li>
          ))}
        </ul>
      ) : null}

      {group.limitations.length > 0 ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-ink-muted">
          {group.limitations.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RecommendationCard({ item }: { item: HealthRecommendationDto }) {
  const severity = SEVERITY_META[item.severity];
  return (
    <div className="rounded-xl border border-line p-3" aria-label={`Gợi ý: ${item.title}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={severity.tone}>{severity.label}</Badge>
        <Badge tone="slate">{MODULE_LABELS[item.module]}</Badge>
        <span className="text-xs text-ink-muted">Tin cậy: {item.confidence}</span>
      </div>
      <p className="mt-2 font-semibold text-ink">{item.title}</p>
      <p className="mt-1 text-sm text-ink-secondary">{item.detail}</p>
      <p className="mt-1 text-sm text-ink-secondary">
        <span className="font-medium">Tác động: </span>
        {item.impact}
      </p>
      {item.evidence.length > 0 ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-secondary">
          {item.evidence.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-muted">
        {item.limitations.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-muted">
        Đây là gợi ý — hệ thống không tự thay đổi giao dịch, ngân sách hay mục tiêu.
      </p>
    </div>
  );
}

function HistoryTable({ history }: { history: FinancialHealthHistoryDto }) {
  if (history.months.length === 0) {
    return (
      <p className="text-sm text-ink-muted">Chưa có tháng nào đã kết thúc để tính lại lịch sử.</p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Điểm dòng tiền và ngân sách tính lại cho các tháng đã kết thúc
        </caption>
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-muted">
            <th className="py-2 pr-3 font-medium">Tháng</th>
            <th className="py-2 pr-3 font-medium">Sức khỏe dòng tiền</th>
            <th className="py-2 font-medium">Quản lý ngân sách</th>
          </tr>
        </thead>
        <tbody>
          {history.months.map((point) => (
            <tr key={point.month} className="border-b border-line last:border-0">
              <td className="py-2 pr-3 text-ink-secondary">{formatMonthLabel(point.month)}</td>
              <td className="py-2 pr-3 text-ink-secondary">
                {point.cashFlow.score === null ? 'Chưa đủ dữ liệu' : `${point.cashFlow.score}/100`}
              </td>
              <td className="py-2 text-ink-secondary">
                {point.budget.score === null ? 'Chưa đủ dữ liệu' : `${point.budget.score}/100`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-ink-muted">
        {history.limitations.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Financial health panel (M3d). Deliberately a rule-based score with the
 * formula shown in the panel, not a gauge or a credit score: there is no
 * needle, no "good/bad" dial and no lending implication. Missing data is shown
 * as "Chưa đủ dữ liệu", never as a zero.
 */
export function AnalyticsHealthPanel({
  data,
  history,
}: {
  data: FinancialHealthDto;
  history?: FinancialHealthHistoryDto;
}) {
  const overall = data.overall;
  return (
    <section className="card" aria-label="Sức khỏe tài chính">
      <div>
        <h2 className="text-lg font-semibold text-ink">Sức khỏe tài chính</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Chỉ báo nội bộ tính từ dữ liệu bạn đã ghi, theo bộ quy tắc công khai bên dưới. Không dùng
          AI/LLM và không tự thay đổi dữ liệu.
        </p>
      </div>

      <p
        className="mt-3 flex items-start gap-2 rounded-xl border border-info-border bg-info-soft px-3 py-2 text-sm text-info-strong"
        role="note"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Đây là chỉ báo nội bộ, không phải điểm tín dụng hay xếp hạng cho vay; điểm chỉ phản ánh dữ
        liệu đã ghi trong ứng dụng.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <span className="font-medium text-ink-secondary">{data.currency}</span>
        <span>· múi giờ {data.timezone}</span>
        <span>· số liệu đến {data.asOf}</span>
        <span>· tạo lúc {formatDateTime(data.generatedAt, data.timezone)}</span>
        <Badge tone="slate">Ước tính theo quy tắc</Badge>
      </div>

      {overall.status === 'scored' && overall.score !== null ? (
        <div className="mt-4 rounded-xl border border-line bg-surface-muted p-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-3xl font-bold tracking-tight text-ink">
              {overall.score}
              <span className="ml-1 text-base font-medium text-ink-muted">/100</span>
            </p>
            {classificationBadge(overall.classification)}
            <Badge tone="slate">
              {overall.availableWeight}% trọng số khả dụng · {data.dataQuality.scoredGroups}/
              {data.dataQuality.totalGroups} nhóm
            </Badge>
          </div>
          <p className="mt-2 text-sm text-ink-secondary">{overall.explanation}</p>
        </div>
      ) : (
        <div className="mt-4">
          <EmptyState title="Chưa đủ dữ liệu để tính điểm tổng" description={overall.explanation} />
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.groups.map((group) => (
          <GroupCard key={group.key} group={group} />
        ))}
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-ink">Gợi ý hành động</h3>
        {data.recommendations.length === 0 ? (
          <p className="mt-1 text-sm text-ink-muted">
            Không có gợi ý nào từ dữ liệu hiện tại. Điểm sẽ được tính lại khi dữ liệu thay đổi.
          </p>
        ) : (
          <div className="mt-2 grid gap-3 lg:grid-cols-2">
            {data.recommendations.map((item) => (
              <RecommendationCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface-muted p-3 text-xs text-ink-secondary">
          <h3 className="text-sm font-semibold text-ink">Cách tính điểm</h3>
          <p className="mt-1">{data.formula}</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {data.scoringRules.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-ink">Chất lượng dữ liệu</h3>
          <ul className="mt-1 space-y-1 text-xs text-ink-secondary">
            <li>
              {data.dataQuality.monthsWithData}/{data.dataQuality.completeMonthsConsidered} tháng đã
              kết thúc có dữ liệu · {data.dataQuality.transactionCount} giao dịch thu/chi.
            </li>
            <li>
              Nhóm được chấm: {data.dataQuality.scoredGroups}/{data.dataQuality.totalGroups}.
            </li>
            <li>
              Mức chất lượng:{' '}
              {data.dataQuality.level === 'good'
                ? 'tốt'
                : data.dataQuality.level === 'limited'
                  ? 'hạn chế'
                  : 'chưa đủ'}
              .
            </li>
            <li>Nhóm thiếu dữ liệu không bao giờ được tính là 0 điểm.</li>
          </ul>
          <h3 className="mt-3 text-sm font-semibold text-ink">Giả định &amp; giới hạn</h3>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-ink-secondary">
            {[...data.assumptions, ...data.limitations].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-ink">Lịch sử điểm (tính lại)</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Điểm tổng không được lưu tự động; lịch sử chỉ tái tạo được nhóm Dòng tiền và Ngân sách cho
          các tháng đã kết thúc, nên không có cột điểm tổng.
        </p>
        <div className="mt-2">
          {history ? (
            <HistoryTable history={history} />
          ) : (
            <p className="text-sm text-ink-muted">Đang tải lịch sử điểm…</p>
          )}
        </div>
      </div>
    </section>
  );
}
