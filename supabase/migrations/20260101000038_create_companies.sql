-- ============================================================
-- Migration 038: companies (contas PJ) + company_operators
-- Spec: /specs/04_api_asaas.md, plano CNPJ (velvet-puzzling-sedgewick)
-- ============================================================
--
-- Uma "company" é uma subconta Asaas de pessoa jurídica, paralela a `users`
-- (que continua sendo só pessoa física). `owner_id` é o cadastro MASTER da
-- empresa — sempre com acesso total, implícito, nunca passa pela matriz de
-- permissões. `company_operators` guarda só os operadores cadastrados pelo
-- master, cada um com uma matriz `permissions` (JSONB) configurável por
-- funcionalidade — não um papel fixo. O master nunca aparece nesta tabela.

-- ── companies ────────────────────────────────────────────────────────────────

CREATE TABLE public.companies (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID        NOT NULL REFERENCES public.users (id),

  asaas_account_id  TEXT        UNIQUE NOT NULL,
  asaas_wallet_id   TEXT,
  asaas_api_key_enc TEXT,

  -- Chave Pix EVP de recebimento da própria subconta (mesmo conceito de
  -- users.asaas_deposit_key, migration 033) — usada por financial-carregar.
  asaas_deposit_key TEXT,

  -- CNPJ armazenado como SHA-256 hash, mesmo padrão de users.cpf
  cnpj              TEXT        UNIQUE NOT NULL,

  company_name      TEXT        NOT NULL, -- razão social
  trading_name      TEXT,                 -- nome fantasia (opcional)

  company_type      TEXT        NOT NULL
                                CHECK (company_type IN ('MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION')),

  address           TEXT        NOT NULL,
  address_number    TEXT        NOT NULL,
  complement        TEXT,
  province          TEXT        NOT NULL, -- bairro
  postal_code       TEXT        NOT NULL,
  city              TEXT,
  state             TEXT,

  -- Faturamento mensal declarado (exigido pelo Asaas como incomeValue)
  income_value      NUMERIC(12, 2) NOT NULL,

  -- Chave Pix de SAQUE da empresa (destino do descarregar) — ainda sem tela
  -- própria de configuração nesta fase; financial-descarregar retorna
  -- COMPANY_PIX_KEY_NOT_CONFIGURED enquanto nula.
  pix_key           TEXT,
  pix_key_type      TEXT        CHECK (pix_key_type IN ('cpf', 'phone', 'email', 'random', 'cnpj')),

  kyc_status        TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (kyc_status IN ('pending', 'submitted', 'approved', 'rejected')),
  account_status    TEXT        NOT NULL DEFAULT 'evaluation'
                                CHECK (account_status IN ('active', 'evaluation', 'blocked')),
  onboarding_url    TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_companies_owner_id ON public.companies (owner_id);

CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── company_operators ─────────────────────────────────────────────────────────

CREATE TABLE public.company_operators (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES public.users (id),

  status      TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'active', 'banned', 'invited')),

  -- Matriz de funcionalidades liberadas para este operador (fail-closed:
  -- chave ausente = negado). Chaves válidas centralizadas em
  -- supabase/functions/_shared/company-permissions.ts.
  permissions JSONB       NOT NULL DEFAULT '{}',

  joined_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (company_id, user_id)
);

CREATE INDEX idx_company_operators_company_id ON public.company_operators (company_id);
CREATE INDEX idx_company_operators_user_id    ON public.company_operators (user_id);

CREATE TRIGGER company_operators_updated_at
  BEFORE UPDATE ON public.company_operators
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── RLS: companies ───────────────────────────────────────────────────────────

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- Master vê a própria empresa
CREATE POLICY companies_select_master ON public.companies
  FOR SELECT
  USING (owner_id = public.auth_user_id());

-- Operador ativo vê a empresa em que opera
CREATE POLICY companies_select_operator ON public.companies
  FOR SELECT
  USING (
    id IN (
      SELECT company_id
      FROM   public.company_operators
      WHERE  user_id = public.auth_user_id()
        AND  status  = 'active'
    )
  );

-- INSERT / UPDATE / DELETE: exclusivos ao service role (company-create etc.)
-- Nenhuma policy adicionada -> bloqueado para roles normais (mesma lição da
-- migration 037: sem UPDATE direto sem restrição de coluna via REST API).

-- ── RLS: company_operators ────────────────────────────────────────────────────

ALTER TABLE public.company_operators ENABLE ROW LEVEL SECURITY;

-- Operador vê sua própria linha (inclusive suas próprias permissions)
CREATE POLICY company_operators_select_own ON public.company_operators
  FOR SELECT
  USING (user_id = public.auth_user_id());

-- Master da empresa vê todos os operadores cadastrados
CREATE POLICY company_operators_select_as_master ON public.company_operators
  FOR SELECT
  USING (
    company_id IN (
      SELECT id FROM public.companies
      WHERE owner_id = public.auth_user_id()
    )
  );

-- INSERT / UPDATE / DELETE: exclusivos ao service role
-- (company-operator-invite / company-operator-join / company-operator-set-permissions)

-- ── users: master precisa ver nome/handle dos operadores para gerenciá-los ───
-- Mesmo padrão da migration 025 (users_select_space_members) — permite que o
-- join company_operators -> users(id,name,handle) funcione via PostgREST.

CREATE POLICY users_select_company_operators_as_master ON public.users
  FOR SELECT
  USING (
    id IN (
      SELECT co.user_id
      FROM   public.company_operators co
      JOIN   public.companies c ON c.id = co.company_id
      WHERE  c.owner_id = public.auth_user_id()
    )
  );
