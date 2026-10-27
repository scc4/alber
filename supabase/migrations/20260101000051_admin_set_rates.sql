-- Funcao do Alber Admin (admin.usealber.com.br): unico caminho de escrita do admin em public.rates.
-- Funcao que o Alber Admin chama para alterar uma taxa de public.rates (cashout, receber, event). O admin nao tem
-- UPDATE na tabela; so EXECUTE nesta funcao, e so a role admin_app.
-- rate e fracao com 4 casas (0.0200 = 2%); a faixa do admin e 0 a 0.3000 (30%), igual aos 3000 bps do Alber Food.
-- updated_by referencia public.users (usuario do app); o admin nao e um deles, entao fica NULL. updated_at: gatilho da tabela.

CREATE OR REPLACE FUNCTION public.admin_set_rates(p_type text, p_rate numeric, p_expected numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_previous numeric;
BEGIN
  IF session_user <> 'admin_app' AND coalesce(current_setting('role', true), 'none') <> 'admin_app' THEN
    RAISE EXCEPTION 'FEE_FORBIDDEN: chamador nao autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_type IS NULL OR p_type NOT IN ('cashout', 'receber', 'event') THEN
    RAISE EXCEPTION 'FEE_KEY_INVALID: tipo de taxa desconhecido' USING ERRCODE = '22023';
  END IF;

  IF p_rate IS NULL OR p_rate < 0 OR p_rate > 0.3000 OR p_rate <> round(p_rate, 4) THEN
    RAISE EXCEPTION 'FEE_OUT_OF_RANGE: valor fora da faixa (0 a 0.3000, ate 4 casas)' USING ERRCODE = '22003';
  END IF;

  SELECT rate INTO v_previous FROM public.rates WHERE type = p_type FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FEE_NOT_CONFIGURED: taxa inexistente' USING ERRCODE = 'P0002';
  END IF;

  IF p_expected IS NOT NULL AND p_expected <> v_previous THEN
    RAISE EXCEPTION 'FEE_STALE: o valor atual mudou' USING ERRCODE = '40001';
  END IF;

  UPDATE public.rates SET rate = p_rate, updated_by = NULL WHERE type = p_type;

  RETURN jsonb_build_object('previous', v_previous, 'new', p_rate);
END $$;

REVOKE ALL ON FUNCTION public.admin_set_rates(text, numeric, numeric) FROM PUBLIC;
-- No Supabase, funcoes novas em public nascem com EXECUTE para anon/authenticated/service_role: tirar explicitamente.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.admin_set_rates(text, numeric, numeric) FROM %I', r);
    END IF;
  END LOOP;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_app') THEN
    GRANT EXECUTE ON FUNCTION public.admin_set_rates(text, numeric, numeric) TO admin_app;
  END IF;
END $$;
