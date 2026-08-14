-- ============================================================
-- Migration 044: companies.deleted_at — libera CNPJ/handle no ciclo de KYC
-- Plano: velvet-puzzling-sedgewick (fase "ciclo de vida do KYC de empresa")
-- ============================================================
--
-- Diferente de users.deleted_at (migration 034), que sobrescreve handle/email
-- com um placeholder e mantém o CPF ocupado para sempre (exclusão definitiva
-- de conta já aprovada) — aqui NÃO sobrescrevemos cnpj/handle: a linha antiga
-- retém o hash original, para permitir detectar padrão de squatting repetido
-- no mesmo CNPJ. A unicidade passa a ser condicional (só entre linhas vivas)
-- via índice parcial, em vez de sobrescrever os valores.
--
-- Preenchido em dois casos:
--   1. webhooks-asaas-kyc marca automaticamente quando o Asaas REJEITA o KYC
--      da empresa — libera o CNPJ/handle na hora para outra pessoa cadastrar.
--   2. company-abandon marca quando o próprio master desiste do cadastro
--      (kyc_status ainda não aprovado) — ex.: digitou o CNPJ errado.
--
-- company-list NÃO filtra deleted_at: o master continua vendo a própria
-- empresa rejeitada/abandonada na lista (marcada como tal), só a checagem de
-- CNPJ/handle disponível para cadastro novo (e este índice) ignoram essas
-- linhas.

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_cnpj_key;
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_handle_key;

CREATE UNIQUE INDEX IF NOT EXISTS companies_cnpj_active_key
  ON public.companies (cnpj) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS companies_handle_active_key
  ON public.companies (handle) WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.companies.deleted_at IS
  'Preenchido quando o KYC da empresa é rejeitado pelo Asaas (libera o CNPJ automaticamente) ou quando o master cancela o próprio cadastro antes da aprovação (company-abandon). Linha e cnpj/handle originais são retidos para auditoria; unicidade de cnpj/handle passa a valer só entre linhas com deleted_at IS NULL.';
