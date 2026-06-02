-- Migration 016: push_tokens
-- Armazena Expo Push Tokens por usuário e plataforma.
-- Referenciada por push-send EF para enviar notificações reais.

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token      TEXT        NOT NULL,
  platform   TEXT        NOT NULL CHECK (platform IN ('ios', 'android')),
  active     BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON public.push_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_active  ON public.push_tokens (user_id, active);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

-- Usuário pode ver e gerenciar apenas seus próprios tokens
CREATE POLICY "push_tokens_own" ON public.push_tokens
  USING (user_id = public.auth_user_id());
