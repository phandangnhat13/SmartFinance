import type { AiAssistantType } from '@smart-finance/shared-types';
import { BookOpen, Info, Sparkles, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AiChatContext } from '../lib/ai-chat-context';
import { openAiChat } from '../lib/ai-chat-events';
import { cn } from '../lib/cn';
import type { Explanation } from '../lib/explanations';

/* ------------------------------- quick help ------------------------------- */

/**
 * Level A: a short definition that stays out of the way until asked for.
 *
 * Native `<details>` keeps it keyboard- and screen-reader-friendly with no
 * state. When a full explanation is supplied, the tooltip also offers the
 * Level B panel, so the two levels never describe the concept differently.
 */
export function HelpTip({
  label,
  children,
  explanation,
  explainContext,
}: {
  /** What is being explained; used for the button's accessible name. */
  label: string;
  children?: ReactNode;
  explanation?: Explanation;
  /** What the page is showing, forwarded to the AI action in the panel. */
  explainContext?: AiChatContext;
}) {
  const content = children ?? explanation?.summary;
  return (
    <details className="group relative inline-block align-middle" data-help-tip>
      <summary
        aria-label={`Giải thích ${label}`}
        className="grid h-5 w-5 cursor-pointer list-none place-items-center rounded-full text-ink-muted ring-1 ring-inset ring-line-strong transition hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden"
      >
        <Info className="h-3 w-3" aria-hidden />
      </summary>
      <div className="absolute left-0 top-6 z-20 w-60 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-normal leading-relaxed text-ink-secondary shadow-pop">
        <div>{content}</div>
        {explanation ? (
          <div className="mt-2 border-t border-line pt-2">
            <ExplainButton
              explanation={explanation}
              label="Giải thích chi tiết"
              variant="link"
              context={explainContext}
            />
          </div>
        ) : null}
      </div>
    </details>
  );
}

/* ------------------------------- detail panel ------------------------------ */

export function ExplainSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h3>
      <div className="mt-1 text-sm leading-relaxed text-ink-secondary">{children}</div>
    </section>
  );
}

/**
 * Level B: a side drawer on desktop and a bottom sheet on small screens.
 *
 * It is a modal dialog: Escape and the backdrop close it, focus is trapped
 * inside while open, page scroll is locked, and focus returns to the control
 * that opened it. No content is rendered when `open` is false, so the panel
 * never adds hidden text to the page.
 */
export function ExplainPanel({
  explanation,
  open,
  onClose,
  context,
}: {
  explanation: Explanation;
  open: boolean;
  onClose: () => void;
  /** What the page is showing when this explanation was opened. */
  context?: AiChatContext;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusable = () => {
      const node = panelRef.current;
      if (!node) return [] as HTMLElement[];
      return Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    };

    focusable()[0]?.focus();

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-stretch sm:justify-end"
      role="presentation"
      onMouseDown={() => onCloseRef.current()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-explain-panel
        className="flex max-h-[85vh] w-full flex-col overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-pop sm:max-h-none sm:w-[27rem] sm:rounded-none sm:border-l sm:border-line"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold text-ink">
            {explanation.title}
          </h2>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            className="icon-btn"
            aria-label="Đóng"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <p className="text-sm leading-relaxed text-ink-secondary">{explanation.summary}</p>

        {explanation.what ? (
          <ExplainSection title="Đây là gì?">{explanation.what}</ExplainSection>
        ) : null}
        {explanation.why ? (
          <ExplainSection title="Vì sao quan trọng?">{explanation.why}</ExplainSection>
        ) : null}
        {explanation.formula ? (
          <ExplainSection title="Cách tính">
            <p className="rounded-lg bg-surface-muted px-3 py-2 font-mono text-xs leading-relaxed text-ink">
              {explanation.formula}
            </p>
          </ExplainSection>
        ) : null}
        {explanation.howToRead ? (
          <ExplainSection title="Cách hiểu">{explanation.howToRead}</ExplainSection>
        ) : null}
        {explanation.limitations?.length ? (
          <ExplainSection title="Giới hạn">
            <ul className="list-disc space-y-1 pl-5">
              {explanation.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </ExplainSection>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
          <AskAIAction
            prompt={explanation.aiPrompt}
            assistantType={explanation.assistantType}
            context={context}
            onBeforeOpen={() => onCloseRef.current()}
          />
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => onCloseRef.current()}
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- entry point ------------------------------ */

/**
 * Opens the Level B panel for one explanation. The button is the only control
 * a page needs to add; the panel state is local to it.
 */
export function ExplainButton({
  explanation,
  label = 'Giải thích',
  variant = 'ghost',
  className,
  context,
}: {
  explanation: Explanation;
  label?: string;
  variant?: 'ghost' | 'link';
  className?: string;
  /** What the page is showing, forwarded to the AI action in the panel. */
  context?: AiChatContext;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${explanation.title}`}
        onClick={() => setOpen(true)}
        className={cn(
          variant === 'link'
            ? 'inline-flex items-center gap-1 text-xs font-medium text-brand hover:text-brand-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50'
            : 'btn-ghost btn-sm',
          className,
        )}
      >
        {variant === 'link' ? (
          <BookOpen className="h-3 w-3" aria-hidden />
        ) : (
          <Info className="h-3.5 w-3.5" aria-hidden />
        )}
        {label}
      </button>
      <ExplainPanel
        explanation={explanation}
        open={open}
        onClose={() => setOpen(false)}
        context={context}
      />
    </>
  );
}

/* --------------------------------- AI action ------------------------------- */

/**
 * Hands a contextual question to the existing global widget. The message is
 * only prefilled; the user still decides whether to send it.
 */
export function AskAIAction({
  prompt,
  assistantType,
  label = 'Hỏi AI về nội dung này',
  className,
  context,
  onBeforeOpen,
}: {
  prompt: string;
  assistantType: AiAssistantType;
  label?: string;
  className?: string;
  /** What the page is showing; shown as a compact indicator in the widget. */
  context?: AiChatContext;
  /** Runs first, e.g. to close the panel that would sit above the widget. */
  onBeforeOpen?: () => void;
}) {
  return (
    <button
      type="button"
      className={cn('btn-secondary btn-sm', className)}
      onClick={() => {
        onBeforeOpen?.();
        openAiChat({ prompt, assistantType, context });
      }}
    >
      <Sparkles className="h-3.5 w-3.5" aria-hidden /> {label}
    </button>
  );
}
