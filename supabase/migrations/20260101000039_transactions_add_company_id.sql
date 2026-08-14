-- ============================================================
-- Migration 039: transactions.company_id
-- Plano CNPJ (velvet-puzzling-sedgewick)
-- ============================================================
--
-- Quando uma operação financeira acontece no contexto de uma empresa,
-- `user_id` continua sendo quem executou (master ou operador autenticado) e
-- `company_id` identifica de qual carteira (subconta) o dinheiro saiu/entrou.
-- NULL = transação pessoal, como hoje.

ALTER TABLE public.transactions
  ADD COLUMN company_id UUID REFERENCES public.companies (id);

CREATE INDEX idx_transactions_company_id ON public.transactions (company_id)
  WHERE company_id IS NOT NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- transactions_select_own (migration 003) já libera SELECT para user_id =
-- auth_user_id() em transações pessoais; para transações de empresa, quem
-- executou já se enxerga por essa policy. Falta liberar visão para o master
-- (ver todas as transações da empresa, mesmo as que outro operador executou)
-- e para operadores com a permissão "ver_extrato" ligada.

CREATE POLICY transactions_select_company_master ON public.transactions
  FOR SELECT
  USING (
    company_id IN (
      SELECT id FROM public.companies
      WHERE owner_id = public.auth_user_id()
    )
  );

CREATE POLICY transactions_select_company_operator ON public.transactions
  FOR SELECT
  USING (
    company_id IN (
      SELECT company_id
      FROM   public.company_operators
      WHERE  user_id      = public.auth_user_id()
        AND  status       = 'active'
        AND  (permissions ->> 'ver_extrato')::boolean IS TRUE
    )
  );
