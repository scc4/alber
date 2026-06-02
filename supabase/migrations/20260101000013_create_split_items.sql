-- Migration 013: split_items — itens lançados pelo dono em splits variáveis
-- Spec: /specs/06_modules/split.md §11.1, §11.2

CREATE TABLE public.split_items (
  id                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  split_id          UUID           NOT NULL REFERENCES public.splits(id) ON DELETE CASCADE,

  description       TEXT           NOT NULL,
  value             NUMERIC(10, 2) NOT NULL CHECK (value > 0),

  -- Valor por participante no momento do lançamento (calculado pelo BFF)
  value_per_person  NUMERIC(10, 2) NOT NULL,
  participant_count INT            NOT NULL,

  -- Foto opcional — armazenada no Supabase Storage (spec §11.1)
  photo_url         TEXT,

  created_at        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX idx_split_items_split_id ON public.split_items (split_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.split_items ENABLE ROW LEVEL SECURITY;

-- Participantes do split veem todos os itens lançados
CREATE POLICY split_items_select ON public.split_items
  FOR SELECT
  USING (
    split_id IN (
      SELECT split_id FROM public.split_participants WHERE user_id = public.auth_user_id()
      UNION ALL
      SELECT id FROM public.splits WHERE owner_id = public.auth_user_id()
    )
  );

-- INSERT / UPDATE: exclusivos ao service role (Edge Function split-launch)
