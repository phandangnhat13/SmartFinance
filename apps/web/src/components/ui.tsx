import { AlertCircle, Eye, EyeOff, Inbox, Loader2, X } from 'lucide-react';
import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import type { InputHTMLAttributes, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/* ------------------------------- feedback ------------------------------- */

export function Spinner({ label = 'Đang tải...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-line/70', className)} />;
}

export function ErrorAlert({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-danger-border bg-danger-soft p-4 text-sm text-danger-strong"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p className="flex-1">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="font-semibold underline">
          Thử lại
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
      {icon ?? <Inbox className="mb-3 h-8 w-8 text-ink-muted" aria-hidden />}
      <p className="font-semibold text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/* -------------------------------- layout -------------------------------- */

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <p className="section-title mb-1">{eyebrow}</p> : null}
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon,
  hint,
  valueClass,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  hint?: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="card min-w-0">
      <div className="flex items-start justify-between gap-3">
        <p className="stat-label">{label}</p>
        {icon ? (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-muted">
            {icon}
          </span>
        ) : null}
      </div>
      <p
        data-numeric
        className={cn('mt-2 text-2xl font-semibold tracking-tight', valueClass ?? 'text-ink')}
      >
        {value}
      </p>
      {hint ? <div className="mt-1 text-xs text-ink-muted">{hint}</div> : null}
    </div>
  );
}

/* ------------------------------- controls ------------------------------- */

/* Status tones are the design system's palette definition, like chartTheme:
   components name a state, not a colour. */
type BadgeTone = 'emerald' | 'rose' | 'amber' | 'slate' | 'sky' | 'violet';

const badgeTones: Record<BadgeTone, string> = {
  emerald: 'bg-brand-soft text-brand-hover ring-brand/20',
  rose: 'bg-danger-soft text-danger-strong ring-danger-border',
  amber: 'bg-warning-soft text-warning-strong ring-warning-border',
  slate: 'bg-surface-muted text-ink-secondary ring-line',
  sky: 'bg-info-soft text-info-strong ring-info-border',
  violet: 'bg-accent-soft text-accent-strong ring-accent-border',
};

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  tone,
  label,
}: {
  value: number;
  tone?: 'emerald' | 'amber' | 'rose';
  label?: string;
}) {
  const color = tone === 'rose' ? 'bg-expense' : tone === 'amber' ? 'bg-warning' : 'bg-brand';
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-line"
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn('h-full rounded-full transition-all', color)}
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
      />
    </div>
  );
}

export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idBase,
  panelId,
}: {
  tabs: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Stable id prefix for tab/panel aria wiring. Defaults to a generated id. */
  idBase?: string;
  /** When set, tabs point `aria-controls` at this tabpanel id. */
  panelId?: string;
}) {
  const generatedId = useId();
  const base = idBase ?? `tabs${generatedId}`;
  const buttonRefs = useRef(new Map<T, HTMLButtonElement>());

  function selectAt(index: number) {
    const next = tabs[(index + tabs.length) % tabs.length];
    if (!next) return;
    onChange(next.value);
    buttonRefs.current.get(next.value)?.focus();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const currentIndex = tabs.findIndex((tab) => tab.value === value);
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectAt(currentIndex + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectAt(currentIndex - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectAt(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectAt(tabs.length - 1);
    }
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1"
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(node) => {
              if (node) buttonRefs.current.set(tab.value, node);
              else buttonRefs.current.delete(tab.value);
            }}
            id={`${base}-tab-${tab.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={cn(
              'whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
              selected
                ? 'bg-brand text-white shadow-sm'
                : 'text-ink-secondary hover:bg-surface-muted hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  itemLabel,
  onPageChange,
  disabled,
}: {
  page: number;
  totalPages: number;
  total: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}) {
  const lastPage = Math.max(totalPages, 1);
  return (
    <nav
      aria-label="Phân trang"
      className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-secondary"
    >
      <span>
        Trang {page} / {lastPage} · {total} {itemLabel}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          Trước
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={disabled || page >= lastPage}
          onClick={() => onPageChange(page + 1)}
        >
          Sau
        </button>
      </div>
    </nav>
  );
}

/* -------------------------------- dialog -------------------------------- */

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusable = () => {
      const node = dialogRef.current;
      if (!node) return [] as HTMLElement[];
      return Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    };

    // Prefer the first form control; otherwise the dialog's first action
    // (Cancel in a confirmation dialog); otherwise the close button.
    const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    );
    const firstAction = dialogRef.current?.querySelector<HTMLElement>(
      '[data-modal-footer] button:not([disabled])',
    );
    (controls?.[0] ?? firstAction ?? focusable()[0])?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const maxWidth = size === 'xl' ? 'max-w-3xl' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      role="presentation"
      onMouseDown={() => onCloseRef.current()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'max-h-[calc(100vh-2rem)] w-full overflow-y-auto rounded-2xl bg-surface p-5 shadow-pop',
          maxWidth,
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            className="icon-btn"
            aria-label="Đóng"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
        {footer ? (
          <div data-modal-footer className="mt-5 flex justify-end gap-2">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Xác nhận',
  cancelLabel = 'Huỷ',
  tone = 'danger',
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? 'Đang xử lý...' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-ink-secondary">{description}</div>
    </Modal>
  );
}

export function FieldError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs text-danger" role="alert">
      {message}
    </p>
  );
}

/**
 * Password field with an explicit show/hide control. It forwards the ref that
 * react-hook-form's `register` returns, so it drops into existing forms.
 */
export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function PasswordInput({ className, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        <input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn('input pr-11', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          aria-pressed={visible}
          className="icon-btn absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden />
          ) : (
            <Eye className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>
    );
  },
);
