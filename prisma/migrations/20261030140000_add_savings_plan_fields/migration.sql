-- Add the paused state without touching existing goal rows.
ALTER TYPE "GoalStatus" ADD VALUE IF NOT EXISTS 'PAUSED';

-- New optional metadata. `currency` has a default so legacy rows stay valid.
ALTER TABLE "savings_goals" ADD COLUMN "description" TEXT;
ALTER TABLE "savings_goals" ADD COLUMN "currency" VARCHAR(3) NOT NULL DEFAULT 'VND';
ALTER TABLE "savings_goals" ADD COLUMN "startDate" DATE;

-- Backfill without discarding data: a legacy goal started when it was created,
-- and its currency follows the owner's default currency.
UPDATE "savings_goals" g SET "startDate" = g."createdAt"::date;
UPDATE "savings_goals" g
SET "currency" = u."defaultCurrency"
FROM "users" u
WHERE u."id" = g."userId";
