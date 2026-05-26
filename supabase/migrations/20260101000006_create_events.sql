-- ============================================================
-- Migration 006: events + event_batches + event_tickets
-- Spec: /specs/03_backend.md §3.8, §3.8b, §3.8c
-- ============================================================

-- ── events ───────────────────────────────────────────────────────────────────

CREATE TABLE public.events (
  id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id     UUID           NOT NULL REFERENCES public.spaces (id) ON DELETE CASCADE,
  creator_id   UUID           NOT NULL REFERENCES public.users (id),

  name         TEXT           NOT NULL,
  description  TEXT,
  image_url    TEXT,
  date         TIMESTAMPTZ    NOT NULL,

  -- 'members': visível apenas para membros do Space
  -- 'public': visível para qualquer usuário
  visibility   TEXT           NOT NULL CHECK (visibility IN ('members', 'public')),

  is_paid      BOOLEAN        NOT NULL DEFAULT false,
  price_brl    NUMERIC(10, 2) CHECK (price_brl IS NULL OR price_brl >= 0),
  price_albers NUMERIC(10, 2) CHECK (price_albers IS NULL OR price_albers >= 0),

  status       TEXT           NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'cancelled')),

  created_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_space_id  ON public.events (space_id);
CREATE INDEX idx_events_date      ON public.events (date);
CREATE INDEX idx_events_status    ON public.events (status);
CREATE INDEX idx_events_visibility ON public.events (visibility);

-- ── event_batches ─────────────────────────────────────────────────────────────

CREATE TABLE public.event_batches (
  id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID           NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,

  batch_number INT            NOT NULL CHECK (batch_number > 0),

  -- 'quantity': ativado por capacidade; 'date': ativado por data
  batch_type   TEXT           NOT NULL CHECK (batch_type IN ('quantity', 'date')),

  price_brl    NUMERIC(10, 2) NOT NULL CHECK (price_brl >= 0),
  capacity     INT            NOT NULL CHECK (capacity > 0),
  sold         INT            NOT NULL DEFAULT 0 CHECK (sold >= 0),

  -- NULL apenas para batch_type = 'quantity' sem prazo
  valid_until  TIMESTAMPTZ,

  status       TEXT           NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'active', 'sold_out', 'expired')),

  created_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),

  UNIQUE (event_id, batch_number),
  CHECK (sold <= capacity)
);

CREATE INDEX idx_event_batches_event_id ON public.event_batches (event_id);
CREATE INDEX idx_event_batches_status   ON public.event_batches (status);

-- ── event_tickets ─────────────────────────────────────────────────────────────

CREATE TABLE public.event_tickets (
  id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID           NOT NULL REFERENCES public.events (id),
  batch_id     UUID           NOT NULL REFERENCES public.event_batches (id),
  user_id      UUID           NOT NULL REFERENCES public.users (id),

  price_brl    NUMERIC(10, 2),
  price_albers NUMERIC(10, 2),

  status       TEXT           NOT NULL DEFAULT 'confirmed'
                              CHECK (status IN ('confirmed', 'refunded')),

  purchased_at TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_tickets_user_id  ON public.event_tickets (user_id);
CREATE INDEX idx_event_tickets_event_id ON public.event_tickets (event_id);
CREATE INDEX idx_event_tickets_batch_id ON public.event_tickets (batch_id);

-- ── RLS: events ──────────────────────────────────────────────────────────────

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Eventos públicos: visíveis para qualquer usuário autenticado
CREATE POLICY events_select_public ON public.events
  FOR SELECT
  TO authenticated
  USING (visibility = 'public' AND status = 'active');

-- Eventos de membros: visíveis apenas para membros ativos do Space
CREATE POLICY events_select_member ON public.events
  FOR SELECT
  USING (
    space_id IN (
      SELECT space_id
      FROM public.space_members
      WHERE user_id = public.auth_user_id()
        AND status = 'active'
    )
  );

-- ── RLS: event_batches ───────────────────────────────────────────────────────

ALTER TABLE public.event_batches ENABLE ROW LEVEL SECURITY;

-- Visível se o evento correspondente estiver visível para o usuário
-- (PostgreSQL aplica RLS de events na subquery automaticamente)
CREATE POLICY event_batches_select ON public.event_batches
  FOR SELECT
  USING (
    event_id IN (SELECT id FROM public.events)
  );

-- ── RLS: event_tickets ───────────────────────────────────────────────────────

ALTER TABLE public.event_tickets ENABLE ROW LEVEL SECURITY;

-- Usuário vê apenas seus próprios ingressos
CREATE POLICY event_tickets_select_own ON public.event_tickets
  FOR SELECT
  USING (user_id = public.auth_user_id());

-- INSERT / UPDATE: exclusivos ao service role (spaces/events Edge Function)
