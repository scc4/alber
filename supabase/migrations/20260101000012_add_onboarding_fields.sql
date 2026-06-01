-- Migration 012: adiciona campos de KYC onboarding na tabela users
-- Spec: /specs/06_modules/onboarding.md §4  |  /specs/04_api_asaas.md §4.7

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS onboarding_url          TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
