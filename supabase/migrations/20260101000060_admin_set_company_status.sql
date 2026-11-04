-- Funcao que o Alber Admin chama para bloquear/desbloquear uma EMPRESA (contencao reversivel, Fase 4 da separacao PF x PJ). Portada de alber-admin/db/product-migrations/alber/0005 em 04/11/2026.
-- Serve a empresa aberta pelo Alber Food, que nao tem usuario do app para bloquear (public.users): a contencao age na propria empresa.
-- O admin nao tem UPDATE na tabela; so EXECUTE nesta funcao, e so a role admin_app.
--   block:   public.companies.account_status active -> blocked
--   unblock: account_status blocked -> active
-- 'evaluation' nunca e tocado. Empresa apagada (deleted_at) nao e bloqueada nem desbloqueada.
-- Efeito no Alber: a guarda de saque ja trata empresa bloqueada como nao operacional (isOperational: account_status <> 'blocked'), entao
-- food-company-withdraw e food-company-set-pix-key respondem COMPANY_NOT_APPROVED. NAO mexe em saldo, subconta Asaas, chave Pix, limites nem
-- operacoes em andamento. Quem pediu e o caso de suporte ficam em admin.containment_actions e admin.audit_log.

CREATE OR REPLACE FUNCTION public.admin_set_company_status(p_company_id uuid, p_action text, p_expected text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_from     text;
  v_to       text;
  v_previous text;
  v_deleted  timestamptz;
BEGIN
  -- Defesa em profundidade: o GRANT abaixo e a trava principal.
  IF session_user <> 'admin_app' AND coalesce(current_setting('role', true), 'none') <> 'admin_app' THEN
    RAISE EXCEPTION 'CONTAIN_FORBIDDEN: chamador nao autorizado' USING ERRCODE = '42501';
  END IF;

  CASE p_action
    WHEN 'block'   THEN v_from := 'active';  v_to := 'blocked';
    WHEN 'unblock' THEN v_from := 'blocked'; v_to := 'active';
    ELSE RAISE EXCEPTION 'CONTAIN_ACTION_INVALID: acao desconhecida' USING ERRCODE = '22023';
  END CASE;

  IF p_company_id IS NULL OR p_expected IS NULL THEN
    RAISE EXCEPTION 'CONTAIN_ARGS_INVALID: empresa e estado esperado sao obrigatorios' USING ERRCODE = '22023';
  END IF;

  SELECT account_status, deleted_at INTO v_previous, v_deleted FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTAIN_NOT_FOUND: empresa inexistente' USING ERRCODE = 'P0002';
  END IF;

  -- Concorrencia otimista: a tela mostrou o estado X; se mudou nesse meio tempo, nao aplica.
  IF p_expected <> v_previous THEN
    RAISE EXCEPTION 'CONTAIN_STALE: o estado atual mudou' USING ERRCODE = '40001';
  END IF;

  IF v_deleted IS NOT NULL OR v_previous <> v_from THEN
    RAISE EXCEPTION 'CONTAIN_INVALID_TRANSITION: de % nao se vai para %', v_previous, v_to USING ERRCODE = '22023';
  END IF;

  UPDATE public.companies SET account_status = v_to, updated_at = now() WHERE id = p_company_id;

  RETURN jsonb_build_object('previous', v_previous, 'new', v_to);
END $$;

REVOKE ALL ON FUNCTION public.admin_set_company_status(uuid, text, text) FROM PUBLIC;
-- No Supabase, funcoes novas em public nascem com EXECUTE para anon/authenticated/service_role: tirar explicitamente.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.admin_set_company_status(uuid, text, text) FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_app') THEN
    GRANT EXECUTE ON FUNCTION public.admin_set_company_status(uuid, text, text) TO admin_app;
  END IF;
END $$;
