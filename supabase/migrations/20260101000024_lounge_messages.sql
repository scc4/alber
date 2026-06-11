-- ============================================================
-- Migration 024: lounge_messages — mensagens persistentes dos gestores
-- Spec: /specs/06_modules/alber_lounge.md § 7 "Painel de gestão"
-- ============================================================

CREATE TABLE public.lounge_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id    UUID        NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  author_id   UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  author_role TEXT        NOT NULL CHECK (author_role IN ('owner', 'admin')),
  content     TEXT        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lounge_messages_space ON public.lounge_messages (space_id, created_at DESC);

ALTER TABLE public.lounge_messages ENABLE ROW LEVEL SECURITY;

-- Membros ativos do lounge podem ler mensagens
CREATE POLICY lounge_messages_select_member ON public.lounge_messages
  FOR SELECT USING (
    space_id IN (
      SELECT space_id FROM public.space_members
      WHERE user_id = public.auth_user_id() AND status = 'active'
    )
  );

-- INSERT / UPDATE / DELETE: exclusivos ao service role (lounge-message-send EF)
