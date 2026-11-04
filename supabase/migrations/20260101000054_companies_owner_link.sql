-- Conferencia do vinculo do responsavel com a empresa (CPF x quadro societario do CNPJ), gravada NA EMPRESA para valer em qualquer
-- canal (app, Alber Food, cadastro junto). Quem confere e o Alber, no ponto unico em que a subconta e criada (createCompanyForOwner).
--
--   owner_link_check:  resultado automatico. unchecked = nao conferida; match = o CPF consta como administrador/titular;
--                      partner = consta como socio sem poderes de administracao; mismatch = nao consta; inactive = CNPJ nao ativo;
--                      unavailable = a consulta ao cadastro do CNPJ nao respondeu.
--   owner_link_review: not_needed (conferida) | pending (aguarda decisao da equipe) | approved | rejected |
--                      legacy (empresa anterior a esta regra: entra na fila de revisao, mas NAO bloqueia o uso).
--   Bloqueia (vendas no Alber Food, saques): pending e rejected.

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS owner_link_check TEXT NOT NULL DEFAULT 'unchecked' CHECK (owner_link_check IN ('unchecked', 'match', 'partner', 'mismatch', 'inactive', 'unavailable'));
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS owner_link_review TEXT NOT NULL DEFAULT 'pending' CHECK (owner_link_review IN ('not_needed', 'pending', 'approved', 'rejected', 'legacy'));
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS owner_link_qualification TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS owner_link_checked_at TIMESTAMPTZ;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS owner_link_reviewed_at TIMESTAMPTZ;

-- Empresas que ja existiam: entram na fila de revisao sem bloquear o uso (decisao de 03/11/2026; hoje sao todas de teste).
UPDATE public.companies SET owner_link_review = 'legacy' WHERE owner_link_checked_at IS NULL AND owner_link_reviewed_at IS NULL;

-- Funcao do Alber Admin: aprovar ou recusar a revisao do vinculo de uma empresa. O admin nao tem UPDATE na tabela; so EXECUTE aqui,
-- e so a role admin_app. Decide revisao pending ou legacy. Nao mexe em saldo, subconta Asaas, PIN nem chave Pix.
CREATE OR REPLACE FUNCTION public.admin_review_company_link(p_company_id uuid, p_decision text, p_expected text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_previous text;
  v_deleted  timestamptz;
  v_to       text;
BEGIN
  -- Defesa em profundidade: o GRANT abaixo e a trava principal.
  IF session_user <> 'admin_app' AND coalesce(current_setting('role', true), 'none') <> 'admin_app' THEN
    RAISE EXCEPTION 'CONTAIN_FORBIDDEN: chamador nao autorizado' USING ERRCODE = '42501';
  END IF;

  CASE p_decision
    WHEN 'approve' THEN v_to := 'approved';
    WHEN 'reject'  THEN v_to := 'rejected';
    ELSE RAISE EXCEPTION 'CONTAIN_ACTION_INVALID: decisao desconhecida' USING ERRCODE = '22023';
  END CASE;

  IF p_company_id IS NULL OR p_expected IS NULL THEN
    RAISE EXCEPTION 'CONTAIN_ARGS_INVALID: empresa e estado esperado sao obrigatorios' USING ERRCODE = '22023';
  END IF;

  SELECT owner_link_review, deleted_at INTO v_previous, v_deleted FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTAIN_NOT_FOUND: empresa inexistente' USING ERRCODE = 'P0002';
  END IF;

  -- Concorrencia otimista: a tela mostrou o estado X; se mudou nesse meio tempo, nao aplica.
  IF p_expected <> v_previous THEN
    RAISE EXCEPTION 'CONTAIN_STALE: o estado atual mudou' USING ERRCODE = '40001';
  END IF;

  IF v_deleted IS NOT NULL OR v_previous NOT IN ('pending', 'legacy') THEN
    RAISE EXCEPTION 'CONTAIN_INVALID_TRANSITION: so revisao pendente ou legada pode ser decidida' USING ERRCODE = '22023';
  END IF;

  UPDATE public.companies SET owner_link_review = v_to, owner_link_reviewed_at = now(), updated_at = now() WHERE id = p_company_id;

  RETURN jsonb_build_object('previous', v_previous, 'new', v_to);
END $$;

REVOKE ALL ON FUNCTION public.admin_review_company_link(uuid, text, text) FROM PUBLIC;
-- No Supabase, funcoes novas em public nascem com EXECUTE para anon/authenticated/service_role: tirar explicitamente.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.admin_review_company_link(uuid, text, text) FROM %I', r);
    END IF;
  END LOOP;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_app') THEN
    GRANT EXECUTE ON FUNCTION public.admin_review_company_link(uuid, text, text) TO admin_app;
  END IF;
END $$;
