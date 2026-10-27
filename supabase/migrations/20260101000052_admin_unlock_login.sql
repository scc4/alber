-- Funcao do Alber Admin (admin.usealber.com.br): destravar o login de um usuario.
-- Funcao que o Alber Admin chama para destravar o login de um usuario (public.users.login_blocked_until). So LIMPA o
-- bloqueio por tentativas: nao mexe em status da conta, PIN, saldo nem em nenhum outro campo. O admin nao tem UPDATE em
-- public.users; so EXECUTE aqui, e so a role admin_app.
-- Devolve {changed, previous, new} com estado resumido (bloqueado ou nao); nunca e-mail, CPF nem hash.
-- A coluna login_blocked_until tem gatilho/politica proprios no Alber (migration 20260101000036/37); esta funcao roda como
-- dono (SECURITY DEFINER), entao nao depende de politica de RLS do usuario final.

CREATE OR REPLACE FUNCTION public.admin_unlock_login(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_blocked timestamptz;
BEGIN
  IF session_user <> 'admin_app' AND coalesce(current_setting('role', true), 'none') <> 'admin_app' THEN
    RAISE EXCEPTION 'ACTION_FORBIDDEN: chamador nao autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'ACTION_TARGET_NOT_FOUND: usuario nao informado' USING ERRCODE = 'P0002';
  END IF;

  SELECT login_blocked_until INTO v_blocked FROM public.users WHERE id = p_user_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACTION_TARGET_NOT_FOUND: usuario inexistente' USING ERRCODE = 'P0002';
  END IF;

  -- Livre (nunca bloqueado ou bloqueio ja vencido e limpo): nada a fazer.
  IF v_blocked IS NULL THEN
    RETURN jsonb_build_object('changed', false, 'previous', jsonb_build_object('blocked', false), 'new', jsonb_build_object('blocked', false));
  END IF;

  UPDATE public.users SET login_blocked_until = NULL WHERE id = p_user_id;

  RETURN jsonb_build_object('changed', true, 'previous', jsonb_build_object('blocked', v_blocked > now()), 'new', jsonb_build_object('blocked', false));
END $$;

REVOKE ALL ON FUNCTION public.admin_unlock_login(uuid) FROM PUBLIC;
-- No Supabase, funcoes novas em public nascem com EXECUTE para anon/authenticated/service_role: tirar explicitamente.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.admin_unlock_login(uuid) FROM %I', r);
    END IF;
  END LOOP;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_app') THEN
    GRANT EXECUTE ON FUNCTION public.admin_unlock_login(uuid) TO admin_app;
  END IF;
END $$;
