import type { AiAssistantType } from '@smart-finance/shared-types';
import { normalizeAiChatContext, type AiChatContext } from './ai-chat-context';

/**
 * A page-level "ask the assistant about this" action opens the floating chat
 * that already lives in the app shell. The event keeps the widget decoupled
 * from every page: a page only says what it wants explained, and the widget
 * stays the single owner of conversation state.
 *
 * The prompt is placed in the composer, never sent automatically: the user
 * still presses send, so no model request (and no cost) happens by accident.
 */
export const AI_CHAT_OPEN_EVENT = 'sf:open-ai-chat';

export interface AiChatOpenDetail {
  prompt: string;
  /** Defaults to the assistant the current route would use. */
  assistantType?: AiAssistantType;
  /**
   * Optional, non-authoritative description of what the user is looking at.
   * Sanitized in `openAiChat`, so pages may pass their local state directly.
   */
  context?: AiChatContext;
}

export function openAiChat(detail: AiChatOpenDetail): void {
  if (typeof window === 'undefined' || !detail.prompt.trim()) return;

  const context = normalizeAiChatContext(detail.context);
  const sanitized: AiChatOpenDetail = {
    prompt: detail.prompt,
    ...(detail.assistantType ? { assistantType: detail.assistantType } : {}),
    ...(context ? { context } : {}),
  };

  window.dispatchEvent(
    new CustomEvent<AiChatOpenDetail>(AI_CHAT_OPEN_EVENT, { detail: sanitized }),
  );
}
