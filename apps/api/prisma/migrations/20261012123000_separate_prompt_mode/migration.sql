ALTER TABLE "users" DROP CONSTRAINT "users_generationPromptMode_check";
ALTER TABLE "users" ADD CONSTRAINT "users_generationPromptMode_check"
  CHECK ("generationPromptMode" IN ('user', 'profile', 'separate'));
