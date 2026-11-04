-- Aumento de limite de saque da empresa (decisao de 04/11/2026): o dono PEDE e a equipe do Alber APROVA no Alber Admin.
-- (supabase/functions/_shared/withdraw-guard.ts aplica os limites; company-limit-request recebe o pedido.)
--
--   companies.withdraw_limit_per_tx_brl / _per_day_brl: limites APROVADOS pela equipe. Substituem os limites padrao (por idade da empresa), os
--                       dois juntos. NULL = padrao. So a funcao admin_decide_limit_request grava (e admin_reset_company_limits apaga).
--   company_limit_requests: um pedido por linha, com o limite que valia quando foi pedido, o pedido, o aprovado e quem decidiu (e-mail da equipe).
--                       Uma unica linha 'pending' por empresa. Gravada so por Edge Function (service role) e pelas funcoes abaixo.

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS withdraw_limit_per_tx_brl NUMERIC(14, 2);
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS withdraw_limit_per_day_brl NUMERIC(14, 2);
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS withdraw_limit_set_at TIMESTAMPTZ;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_withdraw_limits_check
  CHECK (
    (withdraw_limit_per_tx_brl IS NULL AND withdraw_limit_per_day_brl IS NULL)
    OR (withdraw_limit_per_tx_brl IS NOT NULL AND withdraw_limit_per_day_brl IS NOT NULL AND withdraw_limit_per_tx_brl > 0 AND withdraw_limit_per_day_brl >= withdraw_limit_per_tx_brl)
  );

CREATE TABLE public.company_limit_requests (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID          NOT NULL REFERENCES public.companies (id),
  requested_by            UUID          NOT NULL REFERENCES public.users (id),
  requested_per_tx_brl    NUMERIC(14, 2) NOT NULL CHECK (requested_per_tx_brl > 0),
  requested_per_day_brl   NUMERIC(14, 2) NOT NULL,
  current_per_tx_brl      NUMERIC(14, 2) NOT NULL,
  current_per_day_brl     NUMERIC(14, 2) NOT NULL,
  reason                  TEXT          NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 500),
  status                  TEXT          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_per_tx_brl     NUMERIC(14, 2),
  approved_per_day_brl    NUMERIC(14, 2),
  decided_by_email        TEXT,
  decided_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT company_limit_requests_day_check CHECK (requested_per_day_brl >= requested_per_tx_brl),
  CONSTRAINT company_limit_requests_decision_check CHECK (
    (status = 'approved' AND approved_per_tx_brl IS NOT NULL AND approved_per_day_brl IS NOT NULL)
    OR (status <> 'approved' AND approved_per_tx_brl IS NULL AND approved_per_day_brl IS NULL)
  )
);

CREATE UNIQUE INDEX company_limit_requests_one_pending_key ON public.company_limit_requests (company_id) WHERE status = 'pending';
CREATE INDEX idx_company_limit_requests_company ON public.company_limit_requests (company_id, created_at DESC);
CREATE INDEX idx_company_limit_requests_status ON public.company_limit_requests (status, created_at);

-- Sem politica de leitura: so a service role (Edge Functions) e as funcoes SECURITY DEFINER abaixo enxergam a tabela.
ALTER TABLE public.company_limit_requests ENABLE ROW LEVEL SECURITY;

-- Decisao da equipe. Aprovar grava os limites aprovados na empresa e avisa o dono (caixa de entrada do app); recusar so fecha o pedido.
-- Concorrencia otimista: p_expected e o estado que a tela mostrou. Os tetos sao os mesmos de withdraw-guard.ts (LIMIT_REQUEST_CAPS).
CREATE OR REPLACE FUNCTION public.admin_decide_limit_request(p_request_id uuid, p_decision text, p_expected text, p_per_tx numeric, p_per_day numeric, p_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status   text;
  v_company  uuid;
  v_by_user  uuid;
  v_deleted  timestamptz;
  v_to       text;
BEGIN
  IF session_user <> 'admin_app' AND coalesce(current_setting('role', true), 'none') <> 'admin_app' THEN
    RAISE EXCEPTION 'CONTAIN_FORBIDDEN: chamador nao autorizado' USING ERRCODE = '42501';
  END IF;

  CASE p_decision
    WHEN 'approve' THEN v_to := 'approved';
    WHEN 'reject'  THEN v_to := 'rejected';
    ELSE RAISE EXCEPTION 'CONTAIN_ACTION_INVALID: decisao desconhecida' USING ERRCODE = '22023';
  END CASE;

  IF p_request_id IS NULL OR p_expected IS NULL OR p_by IS NULL OR btrim(p_by) = '' THEN
    RAISE EXCEPTION 'CONTAIN_ARGS_INVALID: pedido, estado esperado e responsavel sao obrigatorios' USING ERRCODE = '22023';
  END IF;

  SELECT r.status, r.company_id, r.requested_by, c.deleted_at INTO v_status, v_company, v_by_user, v_deleted
    FROM public.company_limit_requests r JOIN public.companies c ON c.id = r.company_id
   WHERE r.id = p_request_id FOR UPDATE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTAIN_NOT_FOUND: pedido inexistente' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected <> v_status THEN
    RAISE EXCEPTION 'CONTAIN_STALE: o estado atual mudou' USING ERRCODE = '40001';
  END IF;
  IF v_status <> 'pending' OR v_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'CONTAIN_INVALID_TRANSITION: so pedido pendente de empresa ativa pode ser decidido' USING ERRCODE = '22023';
  END IF;

  IF v_to = 'approved' THEN
    IF p_per_tx IS NULL OR p_per_day IS NULL OR p_per_tx <= 0 OR p_per_day < p_per_tx OR p_per_tx > 500000 OR p_per_day > 2000000 THEN
      RAISE EXCEPTION 'CONTAIN_LIMITS_INVALID: valores fora do permitido' USING ERRCODE = '22023';
    END IF;
    UPDATE public.company_limit_requests
       SET status = 'approved', approved_per_tx_brl = p_per_tx, approved_per_day_brl = p_per_day, decided_by_email = left(p_by, 254), decided_at = now(), updated_at = now()
     WHERE id = p_request_id;
    UPDATE public.companies
       SET withdraw_limit_per_tx_brl = p_per_tx, withdraw_limit_per_day_brl = p_per_day, withdraw_limit_set_at = now(), updated_at = now()
     WHERE id = v_company;
  ELSE
    UPDATE public.company_limit_requests
       SET status = 'rejected', decided_by_email = left(p_by, 254), decided_at = now(), updated_at = now()
     WHERE id = p_request_id;
  END IF;

  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, route, metadata)
    VALUES (
      v_by_user,
      'other',
      CASE v_to WHEN 'approved' THEN 'Aumento de limite aprovado' ELSE 'Aumento de limite não aprovado' END,
      CASE v_to
        WHEN 'approved' THEN 'A nossa equipe aprovou o aumento do limite de saque da empresa. Os novos limites já valem.'
        ELSE 'A nossa equipe não aprovou o aumento do limite de saque da empresa agora. Fale com o suporte para entender o motivo.'
      END,
      '/(app)/perfil/dados',
      jsonb_build_object('kind', 'company_limit_request', 'decision', p_decision, 'company_id', v_company, 'request_id', p_request_id)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- o aviso e secundario: a decisao ja foi gravada
  END;

  RETURN jsonb_build_object('previous', v_status, 'new', v_to, 'company_id', v_company);
END $$;

-- Volta a empresa aos limites padrao (apaga os aprovados). Usada pela equipe quando o aumento nao se justifica mais.
CREATE OR REPLACE FUNCTION public.admin_reset_company_limits(p_company_id uuid, p_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tx  numeric;
  v_day numeric;
  v_deleted timestamptz;
BEGIN
  IF session_user <> 'admin_app' AND coalesce(current_setting('role', true), 'none') <> 'admin_app' THEN
    RAISE EXCEPTION 'CONTAIN_FORBIDDEN: chamador nao autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_company_id IS NULL OR p_by IS NULL OR btrim(p_by) = '' THEN
    RAISE EXCEPTION 'CONTAIN_ARGS_INVALID: empresa e responsavel sao obrigatorios' USING ERRCODE = '22023';
  END IF;

  SELECT withdraw_limit_per_tx_brl, withdraw_limit_per_day_brl, deleted_at INTO v_tx, v_day, v_deleted FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTAIN_NOT_FOUND: empresa inexistente' USING ERRCODE = 'P0002';
  END IF;
  IF v_tx IS NULL THEN
    RAISE EXCEPTION 'CONTAIN_INVALID_TRANSITION: a empresa ja esta nos limites padrao' USING ERRCODE = '22023';
  END IF;

  UPDATE public.companies
     SET withdraw_limit_per_tx_brl = NULL, withdraw_limit_per_day_brl = NULL, withdraw_limit_set_at = now(), updated_at = now()
   WHERE id = p_company_id;

  RETURN jsonb_build_object('previous_per_tx', v_tx, 'previous_per_day', v_day, 'new', 'default');
END $$;

-- No Supabase, funcoes novas em public nascem com EXECUTE para anon/authenticated/service_role: tirar explicitamente, e dar so a admin_app.
REVOKE ALL ON FUNCTION public.admin_decide_limit_request(uuid, text, text, numeric, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reset_company_limits(uuid, text) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.admin_decide_limit_request(uuid, text, text, numeric, numeric, text) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.admin_reset_company_limits(uuid, text) FROM %I', r);
    END IF;
  END LOOP;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_app') THEN
    GRANT EXECUTE ON FUNCTION public.admin_decide_limit_request(uuid, text, text, numeric, numeric, text) TO admin_app;
    GRANT EXECUTE ON FUNCTION public.admin_reset_company_limits(uuid, text) TO admin_app;
  END IF;
END $$;
