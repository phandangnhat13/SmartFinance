-- Add an explicit, opt-in consent flag for anonymized AI feedback research.
-- Existing users default to false: no feedback is exported without consent.
ALTER TABLE "users" ADD COLUMN "allowAiResearch" BOOLEAN NOT NULL DEFAULT false;
