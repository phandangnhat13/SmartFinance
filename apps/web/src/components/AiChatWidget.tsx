import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type {
  AiAssistantType,
  AiConversationDto,
  AiConversationListDto,
  AiMessageDto,
  AiMessageListDto,
  SendAiMessageResponseDto,
} from '@smart-finance/shared-types';
import {
  AI_ASSISTANT_LABELS,
  AI_CONVERSATION_TITLE_MAX_LENGTH,
  AI_MESSAGE_MAX_LENGTH,
  AI_MESSAGE_PAGE_SIZE,
  ANALYTICS_AI_SUGGESTED_QUESTIONS,
  SAVINGS_CHAT_SUGGESTED_QUESTIONS,
} from '@smart-finance/shared-types';
import {
  ArrowLeft,
  Bot,
  History,
  Info,
  Loader2,
  MessageSquare,
  Minus,
  Pencil,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  describeAiChatContext,
  isAiChatDraftRelated,
  normalizeAiChatContext,
  type AiChatContext,
} from '../lib/ai-chat-context';
import { AI_CHAT_OPEN_EVENT, type AiChatOpenDetail } from '../lib/ai-chat-events';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import {
  ANALYTICS_INTENT_LABELS,
  chatErrorMessage,
  DisclosureNote,
  EvidenceChips,
  SimulationSummary,
  SourceBadge,
} from './ai/ai-chat-shared';
import { Badge, ConfirmDialog, ErrorAlert, Modal, Skeleton, cn } from './ui';

const CONVERSATIONS_KEY = ['ai-conversations'] as const;
const CONVERSATION_PAGE_SIZE = 20;

function messagesKey(conversationId: string) {
  return ['ai-conversation-messages', conversationId] as const;
}

/**
 * The savings assistant is the natural default on the goals page; everywhere
 * else the financial analyst is. The choice is a default only: the user can
 * switch it before starting a conversation.
 */
function defaultAssistantFor(pathname: string): AiAssistantType {
  return pathname.startsWith('/goals') ? 'SAVINGS' : 'ANALYTICS';
}

function conversationsUrl(page: number, search: string): string {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(CONVERSATION_PAGE_SIZE),
  });
  const query = search.trim();
  if (query) params.set('q', query);
  return `/ai/conversations?${params.toString()}`;
}

function messagesUrl(conversationId: string, page: number): string {
  return `/ai/conversations/${conversationId}/messages?page=${page}&limit=${AI_MESSAGE_PAGE_SIZE}`;
}

/** Mirrors the backend's auto-title so the header stays in step until refetch. */
function titleFromMessage(content: string): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  return collapsed.length > 60 ? `${collapsed.slice(0, 60)}…` : collapsed;
}

/**
 * Floating AI chat shared by every page of the authenticated shell.
 *
 * The widget itself only decides whether it is closed, minimised or open. All
 * conversation data comes from `/ai/conversations`; the model's prose is
 * rendered from the structured reply stored with each assistant message, so
 * evidence, fallback labels, disclosure and (for savings) simulations survive a
 * reload. Nothing here can write financial data: the only mutations are chat
 * turns and conversation titles.
 */
export function AiChatWidget() {
  const location = useLocation();
  const [state, setState] = useState<'closed' | 'open' | 'minimized'>('closed');
  const [request, setRequest] = useState<AiChatOpenDetail | null>(null);
  const defaultAssistant = defaultAssistantFor(location.pathname);

  // "Ask AI about this" actions on a page open the same widget and pre-fill the
  // composer; the user still decides whether to send.
  useEffect(() => {
    function handleOpen(event: Event) {
      const detail = (event as CustomEvent<AiChatOpenDetail>).detail;
      if (!detail?.prompt?.trim()) return;
      setRequest({ ...detail });
      setState('open');
    }
    window.addEventListener(AI_CHAT_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(AI_CHAT_OPEN_EVENT, handleOpen);
  }, []);

  return (
    <>
      {state === 'closed' ? (
        <button
          type="button"
          data-testid="ai-chat-launcher"
          onClick={() => setState('open')}
          aria-label="Mở trợ lý AI"
          aria-haspopup="dialog"
          className="fixed bottom-4 right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-brand text-white shadow-pop transition hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
        >
          <MessageSquare className="h-6 w-6" aria-hidden />
        </button>
      ) : null}

      {state === 'minimized' ? (
        <div className="fixed bottom-4 right-4 z-30 flex items-center gap-1 rounded-full border border-line bg-surface p-1.5 shadow-pop">
          <span className="ml-1 flex items-center gap-1.5 text-xs font-medium text-ink-secondary">
            <Bot className="h-4 w-4 text-brand" aria-hidden />
            Trợ lý AI
          </span>
          <button
            type="button"
            onClick={() => setState('open')}
            aria-label="Mở rộng trò chuyện AI"
            className="icon-btn h-8 w-8"
          >
            <MessageSquare className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setState('closed')}
            aria-label="Đóng trợ lý AI"
            className="icon-btn h-8 w-8"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {state !== 'closed' ? (
        <AiChatPanel
          defaultAssistant={defaultAssistant}
          minimized={state === 'minimized'}
          request={request}
          onMinimize={() => setState('minimized')}
          onClose={() => setState('closed')}
        />
      ) : null}
    </>
  );
}

function AiChatPanel({
  defaultAssistant,
  minimized,
  request,
  onMinimize,
  onClose,
}: {
  defaultAssistant: AiAssistantType;
  minimized: boolean;
  request: AiChatOpenDetail | null;
  onMinimize: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState<string | null>(null);
  const [assistant, setAssistant] = useState<AiAssistantType>(defaultAssistant);
  const [draft, setDraft] = useState('');
  // What the page is showing when it asked for help. It drives a compact
  // indicator and (for currency only) the next request; it is never used as a
  // financial fact by the frontend.
  const [context, setContext] = useState<AiChatContext | null>(null);
  const [mismatch, setMismatch] = useState<{
    assistant: AiAssistantType;
    conversationAssistant: AiAssistantType;
  } | null>(null);
  const contextPromptRef = useRef('');
  const pathname = useLocation().pathname;
  const pathnameRef = useRef(pathname);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [renaming, setRenaming] = useState<AiConversationDto | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<AiConversationDto | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const handledRequest = useRef<AiChatOpenDetail | null>(null);

  const history = useInfiniteQuery({
    queryKey: [...CONVERSATIONS_KEY, deferredSearch],
    queryFn: ({ pageParam }) =>
      api.get<AiConversationListDto>(conversationsUrl(pageParam, deferredSearch)),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    retry: false,
  });

  const messages = useInfiniteQuery({
    queryKey: activeId ? messagesKey(activeId) : ['ai-conversation-messages', 'none'],
    queryFn: ({ pageParam }) => api.get<AiMessageListDto>(messagesUrl(activeId ?? '', pageParam)),
    enabled: activeId !== null,
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    retry: false,
  });

  // Page 1 holds the newest turns and every later page is older, so the pages
  // are reversed for display. Sending while older pages are loaded can overlap
  // one page boundary; de-duplicating by id keeps a single copy of each turn.
  const orderedMessages = useMemo(() => {
    const pages = messages.data?.pages ?? [];
    const byId = new Map<string, AiMessageDto>();
    for (const message of [...pages].reverse().flatMap((page) => page.items)) {
      byId.set(message.id, message);
    }
    return [...byId.values()].sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
  }, [messages.data]);

  useEffect(() => {
    if (!stickToBottom.current) return;
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
    stickToBottom.current = false;
  }, [orderedMessages.length, activeId]);

  const send = useMutation({
    mutationFn: async ({ content, currency }: { content: string; currency?: string }) => {
      let conversationId = activeId;
      if (!conversationId) {
        const created = await api.post<AiConversationDto>('/ai/conversations', {
          assistantType: assistant,
        });
        conversationId = created.id;
      }
      const response = await api.post<SendAiMessageResponseDto>(
        `/ai/conversations/${conversationId}/messages`,
        // The conversation API accepts an optional currency; the rest of the
        // page context is display-only and never sent as a financial fact.
        currency ? { content, currency } : { content },
      );
      return { conversationId, response };
    },
    onSuccess: ({ conversationId, response }, variables) => {
      stickToBottom.current = true;
      if (conversationId === activeId) {
        queryClient.setQueryData<InfiniteData<AiMessageListDto>>(
          messagesKey(conversationId),
          (previous) => {
            const first = previous?.pages[0];
            if (!previous || !first) return previous;
            return {
              ...previous,
              pages: [
                {
                  ...first,
                  items: [...first.items, response.userMessage, response.assistantMessage],
                  total: first.total + 2,
                },
                ...previous.pages.slice(1),
              ],
            };
          },
        );
      } else {
        setActiveId(conversationId);
        setActiveTitle(titleFromMessage(variables.content));
      }
      // A contextual action can prefill a new question while a send is still in
      // flight; only clear the draft if it still holds the text that was sent.
      setDraft((current) => (current === variables.content ? '' : current));
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
    },
  });

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.patch<AiConversationDto>(`/ai/conversations/${id}`, { title }),
    onSuccess: (updated) => {
      if (updated.id === activeId) setActiveTitle(updated.title);
      setRenaming(null);
      setRenameValue('');
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/ai/conversations/${id}`),
    onSuccess: (_value, id) => {
      queryClient.removeQueries({ queryKey: messagesKey(id) });
      if (id === activeId) {
        setActiveId(null);
        setActiveTitle(null);
        setAssistant(defaultAssistant);
        setContext(null);
        setMismatch(null);
        contextPromptRef.current = '';
      }
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
    },
  });

  const conversations = history.data?.pages.flatMap((page) => page.items) ?? [];

  function startNewConversation() {
    setActiveId(null);
    setActiveTitle(null);
    setAssistant(defaultAssistant);
    setDraft('');
    setContext(null);
    setMismatch(null);
    contextPromptRef.current = '';
    setView('chat');
    send.reset();
  }

  function openConversation(conversation: AiConversationDto) {
    stickToBottom.current = true;
    setActiveId(conversation.id);
    setActiveTitle(conversation.title);
    setAssistant(conversation.assistantType);
    setContext(null);
    setMismatch(null);
    contextPromptRef.current = '';
    setView('chat');
    send.reset();
  }

  /** Starts the conversation the incoming question was meant for, keeping the draft. */
  function startFromMismatch() {
    const target = mismatch?.assistant;
    if (!target) return;
    setActiveId(null);
    setActiveTitle(null);
    setAssistant(target);
    setMismatch(null);
    setView('chat');
    send.reset();
  }

  function submit() {
    const content = draft.trim();
    if (!content || send.isPending) return;

    // The question may have moved away from what the page described. Sending it
    // without the old context is safer than attaching an unrelated currency.
    const reference = [contextPromptRef.current, context?.label, context?.feature]
      .filter(Boolean)
      .join(' ');
    const related = context ? isAiChatDraftRelated(content, reference) : false;
    if (context && !related) setContext(null);

    setMismatch(null);
    send.mutate({
      content,
      ...(related && context?.currency ? { currency: context.currency } : {}),
    });
  }

  function submitRename() {
    const title = renameValue.trim();
    if (!renaming || title.length === 0 || title.length > AI_CONVERSATION_TITLE_MAX_LENGTH) return;
    rename.mutate({ id: renaming.id, title });
  }

  // A page asked for help. Each request is handled exactly once: re-running on
  // a route change would overwrite a thread or a newer draft.
  //
  // Continuity: an active conversation is never replaced or retyped silently.
  //  - no conversation yet -> prefill, using the requested assistant;
  //  - same assistant      -> keep the thread and its history, prefill the draft;
  //  - different assistant -> keep the thread and offer an explicit choice.
  const resetSendRef = useRef(send.reset);
  resetSendRef.current = send.reset;
  useEffect(() => {
    if (!request || request === handledRequest.current) return;
    handledRequest.current = request;

    const requestedAssistant = request.assistantType ?? defaultAssistant;
    const incomingContext = normalizeAiChatContext(request.context) ?? null;
    contextPromptRef.current = request.prompt;

    setView('chat');
    setDraft(request.prompt);
    setContext(incomingContext);
    if (!send.isPending) resetSendRef.current();

    if (activeId === null) {
      setAssistant(requestedAssistant);
      setMismatch(null);
    } else if (assistant === requestedAssistant) {
      setMismatch(null);
    } else {
      setMismatch({ assistant: requestedAssistant, conversationAssistant: assistant });
    }

    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [request, defaultAssistant, activeId, assistant, send.isPending]);

  // Context belongs to the page that raised it. Navigating elsewhere in the
  // shell (the widget survives route changes) must not leave a stale label.
  useEffect(() => {
    if (pathnameRef.current === pathname) return;
    pathnameRef.current = pathname;
    setContext(null);
    setMismatch(null);
    contextPromptRef.current = '';
  }, [pathname]);

  if (minimized) return null;

  const suggestions =
    assistant === 'SAVINGS' ? SAVINGS_CHAT_SUGGESTED_QUESTIONS : ANALYTICS_AI_SUGGESTED_QUESTIONS;
  const contextDescription = context ? describeAiChatContext(context) : null;

  return (
    <div
      data-testid="ai-chat-widget"
      role="dialog"
      aria-label="Trợ lý AI"
      className="fixed bottom-3 right-3 z-40 flex h-[min(560px,calc(100dvh-1.5rem))] w-[calc(100vw-1.5rem)] max-w-[380px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop sm:bottom-4 sm:right-4"
    >
      <header className="flex items-start gap-2 border-b border-line bg-surface px-3 py-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-hover">
          <Bot className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">
            {view === 'history' ? 'Lịch sử trò chuyện' : (activeTitle ?? 'Trợ lý AI')}
          </p>
          <p className="truncate text-[11px] text-ink-muted">
            {view === 'history'
              ? 'Mở lại, đổi tên hoặc xoá cuộc trò chuyện'
              : `${AI_ASSISTANT_LABELS[assistant]} · chỉ đọc`}
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          {view === 'chat' ? (
            <button
              type="button"
              onClick={() => setView('history')}
              className="icon-btn h-8 w-8"
              aria-label="Lịch sử trò chuyện"
              title="Lịch sử trò chuyện"
            >
              <History className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setView('chat')}
              className="icon-btn h-8 w-8"
              aria-label="Quay lại trò chuyện"
              title="Quay lại trò chuyện"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={startNewConversation}
            className="icon-btn h-8 w-8"
            aria-label="Cuộc trò chuyện mới"
            title="Cuộc trò chuyện mới"
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onMinimize}
            className="icon-btn h-8 w-8"
            aria-label="Thu nhỏ trò chuyện AI"
            title="Thu nhỏ"
          >
            <Minus className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn h-8 w-8"
            aria-label="Đóng trợ lý AI"
            title="Đóng"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </header>

      {view === 'history' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-line p-3">
            <label className="relative block">
              <span className="sr-only">Tìm cuộc trò chuyện theo tiêu đề</span>
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
                aria-hidden
              />
              <input
                className="input pl-8"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm theo tiêu đề..."
                data-testid="ai-conversation-search"
              />
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {history.isLoading ? (
              <div className="space-y-2 p-1" role="status" aria-live="polite">
                <span className="sr-only">Đang tải lịch sử...</span>
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : history.error ? (
              <ErrorAlert
                message={chatErrorMessage(history.error)}
                onRetry={() => void history.refetch()}
              />
            ) : conversations.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-ink-muted">
                {deferredSearch.trim()
                  ? 'Không tìm thấy cuộc trò chuyện nào khớp tiêu đề.'
                  : 'Chưa có cuộc trò chuyện nào. Hãy bắt đầu một cuộc trò chuyện mới.'}
              </div>
            ) : (
              <ul className="space-y-1" data-testid="ai-conversation-list">
                {conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <div className="flex items-start gap-1 rounded-xl border border-transparent hover:border-line hover:bg-surface-muted">
                      <button
                        type="button"
                        onClick={() => openConversation(conversation)}
                        className="min-w-0 flex-1 rounded-xl px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                        data-testid="ai-conversation-item"
                      >
                        <span className="block truncate text-sm font-medium text-ink">
                          {conversation.title}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <Badge
                            tone={conversation.assistantType === 'SAVINGS' ? 'emerald' : 'sky'}
                          >
                            {AI_ASSISTANT_LABELS[conversation.assistantType]}
                          </Badge>
                          <span className="text-[11px] text-ink-muted">
                            {formatDateTime(conversation.updatedAt)}
                          </span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center py-1 pr-1">
                        <button
                          type="button"
                          className="icon-btn h-8 w-8"
                          aria-label={`Đổi tên ${conversation.title}`}
                          onClick={() => {
                            setRenaming(conversation);
                            setRenameValue(conversation.title);
                            rename.reset();
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="icon-btn h-8 w-8 text-danger"
                          aria-label={`Xoá ${conversation.title}`}
                          onClick={() => {
                            setDeleting(conversation);
                            remove.reset();
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {history.hasNextPage ? (
              <button
                type="button"
                className="btn-secondary mt-2 w-full"
                onClick={() => void history.fetchNextPage()}
                disabled={history.isFetchingNextPage}
              >
                {history.isFetchingNextPage ? 'Đang tải...' : 'Tải thêm'}
              </button>
            ) : null}
          </div>

          {remove.error ? (
            <div className="border-t border-line p-2">
              <ErrorAlert message={chatErrorMessage(remove.error)} />
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div
            ref={messagesRef}
            className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
            data-testid="ai-chat-messages"
          >
            {messages.isLoading ? (
              <div className="space-y-2" role="status" aria-live="polite">
                <span className="sr-only">Đang tải tin nhắn...</span>
                <Skeleton className="h-10 w-2/3" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : messages.error ? (
              <ErrorAlert
                message={chatErrorMessage(messages.error)}
                onRetry={() => void messages.refetch()}
              />
            ) : (
              <>
                {messages.hasNextPage ? (
                  <div className="mb-2 text-center">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => void messages.fetchNextPage()}
                      disabled={messages.isFetchingNextPage}
                    >
                      {messages.isFetchingNextPage
                        ? 'Đang tải tin nhắn cũ...'
                        : 'Tải tin nhắn cũ hơn'}
                    </button>
                  </div>
                ) : null}

                {activeId === null ? (
                  <div className="rounded-xl border border-line bg-surface-muted/50 p-3">
                    <p className="text-sm font-semibold text-ink">Bắt đầu cuộc trò chuyện mới</p>
                    <p className="mt-1 text-xs text-ink-secondary">
                      Chọn trợ lý phù hợp. Cuộc trò chuyện sẽ được lưu để bạn xem lại sau.
                    </p>
                    <div
                      className="mt-2 flex flex-wrap gap-1.5"
                      role="group"
                      aria-label="Chọn trợ lý"
                    >
                      {(['ANALYTICS', 'SAVINGS'] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          aria-pressed={assistant === type}
                          onClick={() => setAssistant(type)}
                          className={cn(
                            'rounded-full border px-3 py-1 text-xs font-medium transition',
                            assistant === type
                              ? 'border-brand bg-brand-soft text-brand-hover'
                              : 'border-line text-ink-secondary hover:bg-surface-muted',
                          )}
                        >
                          {AI_ASSISTANT_LABELS[type]}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {orderedMessages.length === 0 && activeId !== null ? (
                  <p className="p-3 text-center text-sm text-ink-muted">
                    Chưa có tin nhắn trong cuộc trò chuyện này.
                  </p>
                ) : null}

                {orderedMessages.length === 0 && activeId === null ? (
                  <div className="mt-3">
                    <p className="text-xs text-ink-muted">Câu hỏi gợi ý:</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {suggestions.map((question) => (
                        <button
                          key={question}
                          type="button"
                          className="rounded-full border border-line px-3 py-1 text-left text-xs text-ink-secondary hover:bg-surface-muted"
                          onClick={() => {
                            setDraft(question);
                            inputRef.current?.focus();
                          }}
                        >
                          {question}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {orderedMessages.length > 0 ? (
                  <ol
                    className="space-y-3"
                    aria-label="Hội thoại với trợ lý AI"
                    data-testid="ai-chat-log"
                  >
                    {orderedMessages.map((message) => (
                      <MessageBubble key={message.id} message={message} />
                    ))}
                    {send.isPending ? (
                      <li className="flex min-w-0 flex-col gap-1">
                        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                          Trợ lý trả lời
                        </span>
                        <div
                          className="flex items-center gap-2 rounded-xl rounded-tl-sm border border-dashed border-line p-3 text-sm text-ink-muted"
                          role="status"
                          aria-live="polite"
                        >
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          Đang soạn câu trả lời...
                        </div>
                      </li>
                    ) : null}
                  </ol>
                ) : send.isPending ? (
                  <p
                    className="flex items-center gap-2 rounded-xl border border-dashed border-line p-3 text-sm text-ink-muted"
                    role="status"
                    aria-live="polite"
                  >
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Đang soạn câu trả lời...
                  </p>
                ) : null}

                {orderedMessages.length > 0 ? (
                  <p className="mt-3 text-center text-[11px] text-ink-muted">
                    Trợ lý chỉ đọc dữ liệu và không thể tạo, sửa hay xoá giao dịch, ngân sách, mục
                    tiêu, khoản góp hay số dư.
                  </p>
                ) : null}
              </>
            )}
          </div>

          <div className="shrink-0 border-t border-line bg-surface p-2.5">
            {mismatch ? (
              <div
                className="mb-2 rounded-lg border border-warning-border bg-warning-soft p-2 text-xs text-warning-strong"
                role="status"
                data-testid="ai-chat-assistant-mismatch"
              >
                <p className="flex items-start gap-1.5">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    Cuộc trò chuyện này dùng{' '}
                    <strong>{AI_ASSISTANT_LABELS[mismatch.conversationAssistant]}</strong>, còn câu
                    hỏi mới phù hợp với <strong>{AI_ASSISTANT_LABELS[mismatch.assistant]}</strong>.
                  </span>
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={startFromMismatch}
                  >
                    Bắt đầu cuộc trò chuyện mới
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => setMismatch(null)}
                  >
                    Giữ cuộc trò chuyện này
                  </button>
                </div>
              </div>
            ) : null}

            {context && contextDescription ? (
              <div
                className="mb-2 flex items-start gap-2 rounded-lg bg-surface-muted px-2.5 py-1.5 text-xs text-ink-secondary"
                data-testid="ai-chat-context"
              >
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate">
                    Đang hỏi về:{' '}
                    <span className="font-medium text-ink">{contextDescription.focus}</span>
                  </p>
                  {contextDescription.detail ? (
                    <p className="truncate text-[11px] text-ink-muted">
                      {contextDescription.detail}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="icon-btn h-6 w-6 shrink-0"
                  aria-label="Bỏ ngữ cảnh"
                  title="Bỏ ngữ cảnh"
                  onClick={() => {
                    setContext(null);
                    contextPromptRef.current = '';
                  }}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ) : null}

            {send.error ? (
              <div className="mb-2">
                <ErrorAlert message={chatErrorMessage(send.error)} onRetry={submit} />
              </div>
            ) : null}
            <form
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <label className="min-w-0 flex-1">
                <span className="sr-only">Câu hỏi cho trợ lý AI</span>
                <textarea
                  ref={inputRef}
                  className="input max-h-24 min-h-[44px] resize-none py-2"
                  rows={2}
                  maxLength={AI_MESSAGE_MAX_LENGTH}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    if (mismatch) setMismatch(null);
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      submit();
                    }
                  }}
                  placeholder={
                    assistant === 'SAVINGS'
                      ? 'Hỏi về mục tiêu và kế hoạch tiết kiệm...'
                      : 'Hỏi về chi tiêu, ngân sách, dự báo...'
                  }
                  data-testid="ai-chat-input"
                />
              </label>
              <button
                type="submit"
                className="btn-primary h-11 w-11 shrink-0 px-0"
                disabled={send.isPending || draft.trim().length === 0}
                aria-label="Gửi tin nhắn"
                data-testid="ai-chat-send"
              >
                {send.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="h-4 w-4" aria-hidden />
                )}
              </button>
            </form>
            <p className="mt-1.5 flex items-center justify-between text-[11px] text-ink-muted">
              <span>Enter để gửi · Shift+Enter để xuống dòng</span>
              <span>
                {draft.length}/{AI_MESSAGE_MAX_LENGTH}
              </span>
            </p>
          </div>
        </>
      )}

      <Modal
        open={renaming !== null}
        title="Đổi tên cuộc trò chuyện"
        onClose={() => setRenaming(null)}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setRenaming(null)}
              disabled={rename.isPending}
            >
              Huỷ
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={submitRename}
              disabled={
                rename.isPending ||
                renameValue.trim().length === 0 ||
                renameValue.trim().length > AI_CONVERSATION_TITLE_MAX_LENGTH
              }
            >
              {rename.isPending ? 'Đang lưu...' : 'Lưu'}
            </button>
          </>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitRename();
          }}
        >
          <label className="flex flex-col gap-1 text-sm text-ink-secondary">
            <span>Tiêu đề mới</span>
            <input
              className="input"
              value={renameValue}
              maxLength={AI_CONVERSATION_TITLE_MAX_LENGTH}
              onChange={(event) => setRenameValue(event.target.value)}
              autoFocus
            />
          </label>
        </form>
        {rename.error ? (
          <div className="mt-3">
            <ErrorAlert message={chatErrorMessage(rename.error)} />
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Xoá cuộc trò chuyện"
        description={
          deleting
            ? `Xoá “${deleting.title}” cùng toàn bộ tin nhắn? Hành động này không thể hoàn tác.`
            : ''
        }
        confirmLabel="Xoá"
        pending={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function MessageBubble({ message }: { message: AiMessageDto }) {
  const time = (
    <time dateTime={message.createdAt} className="text-[11px] text-ink-muted">
      {formatDateTime(message.createdAt)}
    </time>
  );

  if (message.role === 'USER') {
    return (
      <li className="flex min-w-0 flex-col items-end gap-1">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
          Bạn hỏi · {time}
        </span>
        <p className="max-w-[88%] break-words whitespace-pre-line rounded-xl rounded-tr-sm bg-brand px-3 py-2 text-sm text-white">
          {message.content}
        </p>
      </li>
    );
  }

  return (
    <li className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        Trợ lý trả lời · {time}
      </span>
      <div
        className="min-w-0 rounded-xl rounded-tl-sm border border-line p-3"
        data-testid="ai-chat-reply"
      >
        <StoredReply message={message} />
      </div>
    </li>
  );
}

/** Renders exactly what the backend stored with an assistant message. */
function StoredReply({ message }: { message: AiMessageDto }) {
  const metadata = message.metadata;

  if (!metadata) {
    return (
      <p className="break-words whitespace-pre-line text-sm text-ink-secondary">
        {message.content}
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <SourceBadge
          source={metadata.reply.source}
          aiLabel={metadata.assistantType === 'ANALYTICS' ? 'AI giải thích' : 'AI viết'}
        />
        {metadata.assistantType === 'ANALYTICS' ? (
          <Badge tone="slate">{ANALYTICS_INTENT_LABELS[metadata.reply.intent]}</Badge>
        ) : metadata.reply.scenario ? (
          <Badge tone="amber">Câu trả lời kèm mô phỏng</Badge>
        ) : null}
      </div>
      <p className="mt-1 break-words whitespace-pre-line text-sm text-ink-secondary">
        {message.content}
      </p>
      {metadata.assistantType === 'SAVINGS' && metadata.reply.scenario ? (
        <SimulationSummary simulation={metadata.reply.scenario} />
      ) : null}
      <EvidenceChips
        evidence={
          metadata.assistantType === 'ANALYTICS'
            ? metadata.reply.evidence
            : metadata.reply.references
        }
        label={
          metadata.assistantType === 'ANALYTICS'
            ? 'Bằng chứng từ hệ thống'
            : 'Tham chiếu từ dữ liệu'
        }
      />
      {metadata.reply.clarification ? (
        <p className="mt-2 break-words rounded-lg border border-warning-border bg-warning-soft p-2 text-xs text-warning-strong">
          {metadata.reply.clarification}
        </p>
      ) : null}
      <DisclosureNote disclosure={metadata.reply.disclosure} />
    </>
  );
}
