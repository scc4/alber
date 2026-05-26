-- ============================================================
-- Migration 001: users
-- Spec: /specs/03_backend.md §3.1, /specs/05_security.md §7
-- ============================================================

-- Trigger helper reutilizado por todas as migrations subsequentes
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Tabela ───────────────────────────────────────────────────────────────────

CREATE TABLE public.users (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id           UUID        UNIQUE REFERENCES auth.users(id),
  asaas_account_id  TEXT        UNIQUE NOT NULL,

  -- Credenciais de subconta Asaas armazenadas cifradas (AES-256, spec §7)
  -- Nunca expostas via RLS — somente acessíveis por service role
  asaas_wallet_id   TEXT,
  asaas_api_key_enc TEXT,

  name              TEXT        NOT NULL,
  email             TEXT        UNIQUE NOT NULL,

  -- CPF armazenado como SHA-256 hash (spec 05_security §7)
  cpf               TEXT        UNIQUE NOT NULL,

  phone             TEXT        NOT NULL,
  birth_date        DATE        NOT NULL,
  handle            TEXT        UNIQUE NOT NULL,
  handle_updated_at TIMESTAMPTZ,

  -- Chave Pix cifrada AES-256 no banco (spec 05_security §7)
  pix_key           TEXT,
  pix_key_type      TEXT        CHECK (pix_key_type IN ('cpf', 'phone', 'email', 'random')),

  kyc_status        TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (kyc_status IN ('pending', 'submitted', 'approved', 'rejected')),
  account_status    TEXT        NOT NULL DEFAULT 'evaluation'
                                CHECK (account_status IN ('active', 'evaluation', 'blocked')),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Índices ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_users_auth_id ON public.users (auth_id);
CREATE INDEX idx_users_handle  ON public.users (handle);
CREATE INDEX idx_users_email   ON public.users (email);

-- ── Trigger updated_at ───────────────────────────────────────────────────────

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── Helper: resolve auth.uid() → users.id ────────────────────────────────────
-- Usado em todas as policies RLS subsequentes para evitar subquery repetida.
-- SECURITY DEFINER garante acesso à tabela users sem loop de RLS.

CREATE OR REPLACE FUNCTION public.auth_user_id()
RETURNS UUID AS $$
  SELECT id FROM public.users WHERE auth_id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Leitura: apenas o próprio usuário
CREATE POLICY users_select_own ON public.users
  FOR SELECT
  USING (auth_id = auth.uid());

-- Atualização: apenas o próprio usuário
-- Campos críticos (cpf, asaas_*) só atualizáveis via service role
CREATE POLICY users_update_own ON public.users
  FOR UPDATE
  USING (auth_id = auth.uid());

-- INSERT e DELETE: exclusivos ao service role (Edge Functions)
-- Nenhuma policy adicionada → bloqueado para roles normais
