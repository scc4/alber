-- Funcao do Alber Admin (admin.usealber.com.br): bloquear e desbloquear usuario (contencao reversivel). O auth-login recusa account_status blocked.
-- Funcao que o Alber Admin chama para bloquear/desbloquear um usuario (contencao reversivel, Fase C4).
-- O admin nao tem UPDATE na tabela; so EXECUTE nesta funcao, e so a role admin_app.
--   block:   public.users.account_status active -> blocked
--   unblock: account_status blocked -> active
-- 'evaluation' nunca e tocado (nem entra nem sai por aqui). Nao mexe em saldo, subconta Asaas, PIN nem sessoes abertas.
-- Quem pediu e o caso de suporte ficam em admin.containment_actions e admin.audit_log.
--

CREATE OR REPLACE FUNCTION public.admin_set_user_status(p_user_id uuid, p_action text, p_expected text)
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

  IF p_user_id IS NULL OR p_expected IS NULL THEN
    RAISE EXCEPTION 'CONTAIN_ARGS_INVALID: usuario e estado esperado sao obrigatorios' USING ERRCODE = '22023';
  END IF;

  SELECT account_status, deleted_at INTO v_previous, v_deleted FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTAIN_NOT_FOUND: usuario inexistente' USING ERRCODE = 'P0002';
  END IF;

  IF p_expected <> v_previous THEN
    RAISE EXCEPTION 'CONTAIN_STALE: o estado atual mudou' USING ERRCODE = '40001';
  END IF;

  IF v_deleted IS NOT NULL OR v_previous <> v_from THEN
    RAISE EXCEPTION 'CONTAIN_INVALID_TRANSITION: de % nao se vai para %', v_previous, v_to USING ERRCODE = '22023';
  END IF;

  UPDATE public.users SET account_status = v_to, updated_at = now() WHERE id = p_user_id;

  RETURN jsonb_build_object('previous', v_previous, 'new', v_to);
END $$;

REVOKE ALL ON FUNCTION public.admin_set_user_status(uuid, text, text) FROM PUBLIC;
-- No Supabase, funcoes novas em public nascem com EXECUTE para anon/authenticated/service_role: tirar explicitamente.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.admin_set_user_status(uuid, text, text) FROM %I', r);
    END IF;
  END LOOP;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_app') THEN
    GRANT EXECUTE ON FUNCTION public.admin_set_user_status(uuid, text, text) TO admin_app;
  END IF;
END $$;
