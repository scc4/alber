-- ============================================================
-- Migration 021: add answer_normalized to security_questions
-- Armazena resposta normalizada em texto puro para geração
-- de opções de múltipla escolha mascaradas no login.
-- ============================================================

ALTER TABLE public.security_questions
  ADD COLUMN IF NOT EXISTS answer_normalized TEXT;
