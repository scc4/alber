-- ============================================================
-- Migration 042: company_invites
-- Plano CNPJ (velvet-puzzling-sedgewick) — convite de operador por link
-- ============================================================
--
-- Convite por @handle (company_operators com status='invited', ver migration
-- 038) só funciona pra quem já tem conta no Alber. Para trazer alguém que
-- nunca usou o app, o master gera um link — a pessoa ainda não tem `users.id`
-- nesse momento, então o convite não pode viver em `company_operators`
-- (que exige user_id NOT NULL). Fica numa tabela própria até ser consumido
-- no fim do cadastro enxuto (auth-register com invite_token).

CREATE TABLE public.company_invites (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  token       TEXT        UNIQUE NOT NULL,

  -- Matriz de permissões que o operador vai receber ao aceitar (mesmas
  -- chaves de company_operators.permissions).
  permissions JSONB       NOT NULL DEFAULT '{}',

  status      TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'consumed', 'revoked')),

  created_by  UUID        NOT NULL REFERENCES public.users (id),
  consumed_by UUID        REFERENCES public.users (id),

  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ
);

CREATE INDEX idx_company_invites_token      ON public.company_invites (token);
CREATE INDEX idx_company_invites_company_id ON public.company_invites (company_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Sem policy de SELECT/INSERT/UPDATE para roles normais — todo acesso passa
-- pelas Edge Functions (service role): company-invite-link-create,
-- company-invite-preview (leitura pública controlada, sem expor a tabela) e
-- auth-register (consumo).

ALTER TABLE public.company_invites ENABLE ROW LEVEL SECURITY;
