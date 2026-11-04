-- Fases 4, 5 e 7 do plano de conferencia CNPJ x administrador (docs/plano-conferencia-cnpj-administrador.md no repositorio do Alber Food).
--   kyc_evidence:     retrato do que o Asaas pede/recebeu na subconta (tipo e status de cada grupo de documentos e o TIPO do responsavel).
--                     Nunca nome, documento nem link. Serve a equipe no Alber Admin para decidir a revisao do vinculo com base.
--   kyc_evidence_at:  quando o retrato foi tirado (evita consultar o Asaas a cada listagem).
--   pix_key_hash:     SHA-256 da chave Pix de saque (a chave em si fica cifrada). Permite achar a MESMA chave em empresas diferentes.
--   deleted_reason:   por que a empresa saiu (abandonada, recusada no KYC, substituida por quem tem o vinculo confirmado, pendencia vencida).

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS kyc_evidence JSONB;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS kyc_evidence_at TIMESTAMPTZ;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS pix_key_hash TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS deleted_reason TEXT;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_deleted_reason_check
  CHECK (deleted_reason IS NULL OR deleted_reason IN ('abandoned', 'kyc_rejected', 'superseded', 'expired'));

CREATE INDEX IF NOT EXISTS idx_companies_pix_key_hash ON public.companies (pix_key_hash)
  WHERE pix_key_hash IS NOT NULL AND deleted_at IS NULL;

-- A decisao da equipe sobre o vinculo agora avisa o dono: uma notificacao na caixa de entrada do app (a tabela publica o realtime, entao
-- aparece na hora com o app aberto). O aviso nao pode derrubar a decisao: se falhar, a decisao vale e o erro e ignorado.
CREATE OR REPLACE FUNCTION public.admin_review_company_link(p_company_id uuid, p_decision text, p_expected text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_previous text;
  v_deleted  timestamptz;
  v_owner    uuid;
  v_to       text;
BEGIN
  -- Defesa em profundidade: o GRANT e a trava principal.
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

  SELECT owner_link_review, deleted_at, owner_id INTO v_previous, v_deleted, v_owner FROM public.companies WHERE id = p_company_id FOR UPDATE;
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

  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, route, metadata)
    VALUES (
      v_owner,
      'other',
      CASE v_to WHEN 'approved' THEN 'Vínculo com a empresa confirmado' ELSE 'Vínculo com a empresa não confirmado' END,
      CASE v_to
        WHEN 'approved' THEN 'A nossa equipe confirmou o seu vínculo com a empresa. Os saques da empresa estão liberados.'
        ELSE 'A nossa equipe não conseguiu confirmar o seu vínculo com a empresa. Fale com o suporte para entender o motivo.'
      END,
      '/(app)/perfil/dados',
      jsonb_build_object('kind', 'company_link_review', 'decision', p_decision, 'company_id', p_company_id)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- o aviso e secundario: a decisao ja foi gravada
  END;

  RETURN jsonb_build_object('previous', v_previous, 'new', v_to);
END $$;
