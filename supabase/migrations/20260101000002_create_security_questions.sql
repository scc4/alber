-- ============================================================
-- Migration 002: security_questions
-- Spec: /specs/03_backend.md §3.2, /specs/05_security.md §3
-- ============================================================

CREATE TABLE public.security_questions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,

  question    TEXT        NOT NULL,

  -- Resposta armazenada como bcrypt cost 12 (spec 05_security §7)
  -- Nunca armazenada em texto puro em nenhuma camada
  answer_hash TEXT        NOT NULL,

  position    INT         NOT NULL CHECK (position BETWEEN 1 AND 4),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, position)
);

-- ── Índices ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_security_questions_user_id ON public.security_questions (user_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.security_questions ENABLE ROW LEVEL SECURITY;

-- Leitura: apenas o próprio usuário pode ver suas perguntas
-- (respostas nunca exibidas na UI — apenas pergunta e status "cadastrada")
CREATE POLICY security_questions_select_own ON public.security_questions
  FOR SELECT
  USING (user_id = public.auth_user_id());

-- INSERT / UPDATE / DELETE: exclusivos ao service role
-- Cadastro e atualização feitos exclusivamente via Edge Function auth/register
-- e users/security-questions (exige PIN + código SMS, spec 05_security §3)
