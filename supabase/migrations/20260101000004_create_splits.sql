-- ============================================================
-- Migration 004: splits + split_participants
-- Spec: /specs/03_backend.md §3.4, §3.5, §5.3
-- ============================================================

-- ── splits ───────────────────────────────────────────────────────────────────

CREATE TABLE public.splits (
  id                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID           NOT NULL REFERENCES public.users (id),

  name              TEXT           NOT NULL,
  type              TEXT           NOT NULL CHECK (type IN ('fixed', 'variable')),

  -- Valor total a ser dividido (em Albers)
  target_amount     NUMERIC(10, 2) NOT NULL CHECK (target_amount > 0),

  -- Token de convite único; link: alber.app/split/{token}
  invite_token      TEXT           UNIQUE NOT NULL,
  invite_expires_at TIMESTAMPTZ    NOT NULL,

  -- NULL = sem limite de participantes
  max_participants  INT            CHECK (max_participants IS NULL OR max_participants > 1),

  status            TEXT           NOT NULL DEFAULT 'open'
                                   CHECK (status IN ('open', 'closed', 'expired')),
  closed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX idx_splits_owner_id     ON public.splits (owner_id);
CREATE INDEX idx_splits_invite_token ON public.splits (invite_token);
CREATE INDEX idx_splits_status       ON public.splits (status);

-- ── split_participants ────────────────────────────────────────────────────────

CREATE TABLE public.split_participants (
  id             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  split_id       UUID           NOT NULL REFERENCES public.splits (id) ON DELETE CASCADE,
  user_id        UUID           NOT NULL REFERENCES public.users (id),

  status         TEXT           NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'accepted', 'settled')),

  -- Valor bloqueado no saldo do participante (spec §5.3)
  blocked_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,

  -- Valor final debitado após fechamento do split
  final_amount   NUMERIC(10, 2),

  joined_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT now(),

  UNIQUE (split_id, user_id)
);

CREATE INDEX idx_split_participants_split_id ON public.split_participants (split_id);
CREATE INDEX idx_split_participants_user_id  ON public.split_participants (user_id);

-- ── RLS: splits ──────────────────────────────────────────────────────────────

ALTER TABLE public.splits ENABLE ROW LEVEL SECURITY;

-- Dono vê seus splits
CREATE POLICY splits_select_owner ON public.splits
  FOR SELECT
  USING (owner_id = public.auth_user_id());

-- Participante vê splits nos quais está
CREATE POLICY splits_select_participant ON public.splits
  FOR SELECT
  USING (
    id IN (
      SELECT split_id
      FROM public.split_participants
      WHERE user_id = public.auth_user_id()
    )
  );

-- ── RLS: split_participants ───────────────────────────────────────────────────

ALTER TABLE public.split_participants ENABLE ROW LEVEL SECURITY;

-- Participante vê sua própria linha
CREATE POLICY split_participants_select_own ON public.split_participants
  FOR SELECT
  USING (user_id = public.auth_user_id());

-- Dono do split vê todos os participantes
CREATE POLICY split_participants_select_as_owner ON public.split_participants
  FOR SELECT
  USING (
    split_id IN (
      SELECT id FROM public.splits
      WHERE owner_id = public.auth_user_id()
    )
  );

-- INSERT / UPDATE: exclusivos ao service role (Edge Functions split/join, split/close)
