import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AiMessage } from '@prisma/client';
import {
  AI_CONVERSATION_DEFAULT_TITLE,
  type AiAssistantType,
  type AiChatMessageMetadataDto,
  type AiConversationDto,
  type AiConversationListDto,
  type AiMessageDto,
  type AiMessageListDto,
  type SendAiMessageResponseDto,
} from '@smart-finance/shared-types';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AnalyticsAnalystService } from '../analytics-analyst/analytics-analyst.service';
import { SavingsAssistantService } from '../savings-assistant/savings-assistant.service';
import type {
  CreateAiConversationDto,
  ListAiConversationsQuery,
  ListAiMessagesQuery,
  SendAiMessageDto,
  UpdateAiConversationDto,
} from './dto/conversations.dto';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DEFAULT_MESSAGE_PAGE_SIZE = 30;
/** The same bound the savings chat DTO enforces; the model never sees more. */
const MAX_HISTORY_MESSAGES = 10;
const MAX_TITLE_FROM_MESSAGE = 60;

/**
 * Persistent AI conversations shared by both assistants.
 *
 * Every operation filters by `userId` as well as `id`, so a guessed id can
 * never reach another account's transcript (IDOR-safe by construction). The
 * financial context is not stored: a stored assistant message keeps only the
 * structured pieces needed to re-render it, and the full reply is produced by
 * the existing read-only assistant services.
 */
@Injectable()
export class AiConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly savings: SavingsAssistantService,
    private readonly analytics: AnalyticsAnalystService,
  ) {}

  async list(userId: string, query: ListAiConversationsQuery): Promise<AiConversationListDto> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const search = query.q?.trim();
    const where: Prisma.AiConversationWhereInput = {
      userId,
      ...(query.assistantType ? { assistantType: query.assistantType } : {}),
      ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.aiConversation.count({ where }),
      this.prisma.aiConversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: rows.map(toConversationDto),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async create(userId: string, dto: CreateAiConversationDto): Promise<AiConversationDto> {
    const row = await this.prisma.aiConversation.create({
      data: {
        userId,
        title: dto.title ?? AI_CONVERSATION_DEFAULT_TITLE,
        assistantType: dto.assistantType,
      },
    });
    return toConversationDto(row);
  }

  async getOne(userId: string, id: string): Promise<AiConversationDto> {
    return toConversationDto(await this.requireConversation(userId, id));
  }

  async rename(
    userId: string,
    id: string,
    dto: UpdateAiConversationDto,
  ): Promise<AiConversationDto> {
    const result = await this.prisma.aiConversation.updateMany({
      where: { id, userId },
      data: { title: dto.title },
    });
    if (result.count === 0) throw notFound();
    return this.getOne(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    // Messages go with the conversation through the FK's ON DELETE CASCADE.
    const result = await this.prisma.aiConversation.deleteMany({ where: { id, userId } });
    if (result.count === 0) throw notFound();
  }

  /**
   * Page 1 holds the newest messages; higher pages hold older ones. Items are
   * always returned in chronological order so a client can prepend a page
   * without re-sorting.
   */
  async listMessages(
    userId: string,
    id: string,
    query: ListAiMessagesQuery,
  ): Promise<AiMessageListDto> {
    await this.requireConversation(userId, id);
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? DEFAULT_MESSAGE_PAGE_SIZE, MAX_PAGE_SIZE);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.aiMessage.count({ where: { conversationId: id } }),
      this.prisma.aiMessage.findMany({
        where: { conversationId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: rows.reverse().map(toMessageDto),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async sendMessage(
    userId: string,
    id: string,
    dto: SendAiMessageDto,
  ): Promise<SendAiMessageResponseDto> {
    const conversation = await this.requireConversation(userId, id);

    // Only a bounded tail of the transcript is used as model context.
    const recent = await this.prisma.aiMessage.findMany({
      where: { conversationId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_HISTORY_MESSAGES,
      select: { role: true, content: true },
    });
    const history = recent.reverse().map((message) => ({
      role: message.role === 'USER' ? ('user' as const) : ('assistant' as const),
      content: message.content,
    }));

    // The assistant services own every financial calculation and fall back on
    // provider failure. An unexpected throw reaches the client as an error and
    // nothing is written, so a failed request never leaves a misleading answer.
    const reply =
      conversation.assistantType === 'SAVINGS'
        ? await this.savings.chat(userId, {
            message: dto.content,
            history,
            ...(dto.currency ? { currency: dto.currency } : {}),
          })
        : await this.analytics.chat(
            userId,
            {
              message: dto.content,
              ...(dto.currency ? { currency: dto.currency } : {}),
            },
            history,
          );

    const metadata = storedMetadata(conversation.assistantType, reply);
    const isFirstMessage = recent.length === 0;
    const base = Date.now();

    const saved = await this.prisma.$transaction(async (tx) => {
      const userMessage = await tx.aiMessage.create({
        data: {
          conversationId: id,
          role: 'USER',
          content: dto.content,
          createdAt: new Date(base),
        },
      });
      const assistantMessage = await tx.aiMessage.create({
        data: {
          conversationId: id,
          role: 'ASSISTANT',
          content: reply.reply,
          metadata: metadata as unknown as Prisma.InputJsonValue,
          // Explicit, monotonically ordered timestamps keep the pair in order
          // even when the whole transaction shares one database clock value.
          createdAt: new Date(base + 1),
        },
      });
      await tx.aiConversation.update({
        where: { id },
        data: {
          ...(isFirstMessage && conversation.title === AI_CONVERSATION_DEFAULT_TITLE
            ? { title: titleFromMessage(dto.content) }
            : {}),
        },
      });
      return { userMessage, assistantMessage };
    });

    return {
      userMessage: toMessageDto(saved.userMessage),
      assistantMessage: toMessageDto(saved.assistantMessage),
    };
  }

  private async requireConversation(userId: string, id: string) {
    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id, userId },
      select: {
        id: true,
        title: true,
        assistantType: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!conversation) throw notFound();
    return conversation;
  }
}

/* ------------------------------ helpers ------------------------------ */

function notFound(): NotFoundException {
  return new NotFoundException('Không tìm thấy cuộc trò chuyện');
}

function toConversationDto(row: {
  id: string;
  title: string;
  assistantType: AiAssistantType;
  createdAt: Date;
  updatedAt: Date;
}): AiConversationDto {
  return {
    id: row.id,
    title: row.title,
    assistantType: row.assistantType,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMessageDto(row: AiMessage): AiMessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: row.content,
    metadata: parseMetadata(row.metadata),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Only the fields the widget renders are persisted: no facts grid, no full
 * deterministic context, no user identifiers.
 */
function storedMetadata(
  assistantType: AiAssistantType,
  reply:
    | Awaited<ReturnType<SavingsAssistantService['chat']>>
    | Awaited<ReturnType<AnalyticsAnalystService['chat']>>,
): AiChatMessageMetadataDto {
  if (assistantType === 'SAVINGS') {
    const savings = reply as Awaited<ReturnType<SavingsAssistantService['chat']>>;
    return {
      assistantType: 'SAVINGS',
      reply: {
        currency: savings.currency,
        timezone: savings.timezone,
        generatedAt: savings.generatedAt,
        source: savings.source,
        intent: savings.intent,
        references: savings.references,
        scenario: savings.scenario,
        clarification: savings.clarification,
        canModifyData: false,
        disclosure: savings.disclosure,
      },
    };
  }
  const analytics = reply as Awaited<ReturnType<AnalyticsAnalystService['chat']>>;
  return {
    assistantType: 'ANALYTICS',
    reply: {
      currency: analytics.currency,
      timezone: analytics.timezone,
      generatedAt: analytics.generatedAt,
      source: analytics.source,
      intent: analytics.intent,
      evidence: analytics.evidence,
      clarification: analytics.clarification,
      canModifyData: false,
      disclosure: analytics.disclosure,
    },
  };
}

function parseMetadata(value: Prisma.JsonValue | null): AiChatMessageMetadataDto | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.assistantType !== 'SAVINGS' && record.assistantType !== 'ANALYTICS') return null;
  if (!record.reply || typeof record.reply !== 'object' || Array.isArray(record.reply)) return null;
  return value as unknown as AiChatMessageMetadataDto;
}

export function titleFromMessage(content: string): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  if (!collapsed) return AI_CONVERSATION_DEFAULT_TITLE;
  return collapsed.length <= MAX_TITLE_FROM_MESSAGE
    ? collapsed
    : `${collapsed.slice(0, MAX_TITLE_FROM_MESSAGE - 1)}…`;
}
