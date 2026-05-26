-- ============================================================
-- Migration 005: spaces (Alber Lounges) + space_members
-- Spec: /specs/03_backend.md §3.6, §3.7
-- ============================================================

-- ── spaces ───────────────────────────────────────────────────────────────────

CREATE TABLE public.spaces (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL,

  -- 'open': visível para qualquer usuário (Explorar)
  -- 'closed': visível apenas para membros ativos
  type             TEXT        NOT NULL CHECK (type IN ('open', 'closed')),

  owner_id         UUID        NOT NULL REFERENCES public.users (id),

  -- Subconta Asaas do Space para eventos pagos (criada sob conta pai Alber)
  asaas_account_id TEXT,

  -- Visual: { accent, bgDark, skin } — chave do spaceSkins do app
  skin             JSONB       NOT NULL DEFAULT '{}',

  status           TEXT        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'suspended', 'deleted')),

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_spaces_owner_id ON public.spaces (owner_id);
CREATE INDEX idx_spaces_status   ON public.spaces (status);
CREATE INDEX idx_spaces_type     ON public.spaces (type);

-- ── space_members ─────────────────────────────────────────────────────────────

CREATE TABLE public.space_members (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id   UUID        NOT NULL REFERENCES public.spaces (id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES public.users (id),

  role       TEXT        NOT NULL DEFAULT 'member'
                         CHECK (role IN ('owner', 'admin', 'member')),
  status     TEXT        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'active', 'banned')),

  joined_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (space_id, user_id)
);

CREATE INDEX idx_space_members_space_id ON public.space_members (space_id);
CREATE INDEX idx_space_members_user_id  ON public.space_members (user_id);

-- ── RLS: spaces ──────────────────────────────────────────────────────────────

ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;

-- Membros ativos veem seus Lounges (qualquer tipo)
CREATE POLICY spaces_select_member ON public.spaces
  FOR SELECT
  USING (
    id IN (
      SELECT space_id
      FROM public.space_members
      WHERE user_id = public.auth_user_id()
        AND status = 'active'
    )
  );

-- Lounges abertos são visíveis para qualquer usuário autenticado (Explorar)
CREATE POLICY spaces_select_open ON public.spaces
  FOR SELECT
  TO authenticated
  USING (type = 'open' AND status = 'active');

-- Apenas o dono pode atualizar o Space (nome, visual, etc.)
CREATE POLICY spaces_update_owner ON public.spaces
  FOR UPDATE
  USING (owner_id = public.auth_user_id());

-- ── RLS: space_members ───────────────────────────────────────────────────────

ALTER TABLE public.space_members ENABLE ROW LEVEL SECURITY;

-- Usuário vê sua própria membership
CREATE POLICY space_members_select_own ON public.space_members
  FOR SELECT
  USING (user_id = public.auth_user_id());

-- Dono/admin do Space vê todos os membros
CREATE POLICY space_members_select_as_manager ON public.space_members
  FOR SELECT
  USING (
    space_id IN (
      SELECT id FROM public.spaces
      WHERE owner_id = public.auth_user_id()
    )
  );

-- INSERT / UPDATE / DELETE: exclusivos ao service role (spaces/join, spaces/manage)
