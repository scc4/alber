-- ============================================================
-- Migration 029: notifications
-- Central de notificações do app (sininho) — transações, convites etc.
-- Gravada centralmente por push-send (ver supabase/functions/push-send)
-- toda vez que uma Edge Function interna dispara um push, com ou sem
-- token de dispositivo ativo.
-- ============================================================

CREATE TABLE public.notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES public.users (id),

  -- 'transaction' | 'invite' | 'other'
  type       TEXT        NOT NULL DEFAULT 'other',

  title      TEXT        NOT NULL,
  body       TEXT        NOT NULL,

  -- Deep link do app (ex: '/(app)/split/convite/{token}') — mesmo contrato
  -- já usado no payload de push (data.route)
  route      TEXT,

  metadata   JSONB       NOT NULL DEFAULT '{}',

  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_created ON public.notifications (user_id, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Somente leitura pelo próprio usuário
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT
  USING (user_id = public.auth_user_id());

-- INSERT/UPDATE: exclusivos ao service role
-- Nenhuma policy adicionada → bloqueado para roles normais.
-- Gravação via push-send (INSERT) e notifications-mark-read (UPDATE read_at).
