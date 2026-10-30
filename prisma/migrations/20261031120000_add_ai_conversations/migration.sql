-- Persistent AI conversations shared by the savings assistant and the
-- analytics analyst. A conversation and all of its messages disappear with
-- their owner; deleting a conversation deletes its messages.

CREATE TYPE "AiAssistantType" AS ENUM ('SAVINGS', 'ANALYTICS');
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT');

CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "assistantType" "AiAssistantType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_conversations_userId_updatedAt_idx"
    ON "ai_conversations" ("userId", "updatedAt" DESC);

CREATE INDEX "ai_conversations_userId_assistantType_updatedAt_idx"
    ON "ai_conversations" ("userId", "assistantType", "updatedAt" DESC);

CREATE INDEX "ai_messages_conversationId_createdAt_idx"
    ON "ai_messages" ("conversationId", "createdAt");

ALTER TABLE "ai_conversations"
    ADD CONSTRAINT "ai_conversations_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_messages"
    ADD CONSTRAINT "ai_messages_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
