-- Alber como backend de servico do Alber Food (fase 1 do plano de separacao PF x PJ, docs/plano-separacao-pf-pj.md no repositorio do Alber Food).
-- O dono do restaurante NAO tem usuario no Alber: a empresa conhece so uma referencia opaca dele (owner_ref = id da conta no Alber Food).
-- Tudo aqui e aditivo e idempotente. Nao mexe em users, nas policies de RLS nem em nenhuma outra tabela alem das listadas.
--
--   companies.owner_id           passa a aceitar nulo (empresa do Alber Food nao tem dono em users)
--   companies.owner_ref          id opaco da conta do dono no Alber Food (texto, ate 128 caracteres)
--   companies.origin             'app' (aberta pelo app Alber, dono em users) | 'food' (aberta pelo Alber Food, dono so por owner_ref)
--   companies.pix_key_set_at     quando a chave Pix de saque foi cadastrada (qualquer tipo). Diferente de pix_key_changed_at, que so existe
--                                para chave aleatoria e e o que a guarda de saque usa para a espera de 48 h
--   transactions.user_id         passa a aceitar nulo; actor_ref guarda quem pediu quando nao ha usuario (saque feito pelo Alber Food)
--   company_limit_requests       requested_by passa a aceitar nulo; requested_by_ref guarda o dono (owner_ref) que pediu
--   food_ops                     autorizacoes assinadas ja usadas (nonce) e idempotencia das operacoes do Alber Food (saque, chave Pix, titular)
--
-- Efeitos de owner_id nulo (conferidos): as policies de RLS comparam owner_id com auth_user_id() e nulo nunca casa, entao a empresa do Alber
-- Food nao aparece para nenhum usuario do app (certo). As funcoes admin_review_company_link e admin_decide_limit_request avisam o dono por
-- notificacao in-app; sem usuario nao ha para quem avisar, entao o aviso e pulado (redefinidas abaixo, mesmo comportamento para o app).

-- ── companies ────────────────────────────────────────────────────────────────

ALTER TABLE public.companies ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS owner_ref TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'app';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS pix_key_set_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.companies'::regclass AND conname = 'companies_origin_check') THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_origin_check CHECK (origin IN ('app', 'food'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.companies'::regclass AND conname = 'companies_owner_present_check') THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_owner_present_check CHECK (owner_id IS NOT NULL OR owner_ref IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.companies'::regclass AND conname = 'companies_owner_ref_length_check') THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_owner_ref_length_check CHECK (owner_ref IS NULL OR char_length(owner_ref) BETWEEN 1 AND 128);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_companies_owner_ref ON public.companies (owner_ref) WHERE owner_ref IS NOT NULL;

-- ── transactions ─────────────────────────────────────────────────────────────

ALTER TABLE public.transactions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS actor_ref TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.transactions'::regclass AND conname = 'transactions_actor_present_check') THEN
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_actor_present_check CHECK (user_id IS NOT NULL OR actor_ref IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.transactions'::regclass AND conname = 'transactions_actor_ref_length_check') THEN
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_actor_ref_length_check CHECK (actor_ref IS NULL OR char_length(actor_ref) BETWEEN 1 AND 128);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_actor_ref ON public.transactions (actor_ref) WHERE actor_ref IS NOT NULL;

-- ── company_limit_requests ───────────────────────────────────────────────────

ALTER TABLE public.company_limit_requests ALTER COLUMN requested_by DROP NOT NULL;
ALTER TABLE public.company_limit_requests ADD COLUMN IF NOT EXISTS requested_by_ref TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.company_limit_requests'::regclass AND conname = 'company_limit_requests_requester_present_check') THEN
    ALTER TABLE public.company_limit_requests ADD CONSTRAINT company_limit_requests_requester_present_check CHECK (requested_by IS NOT NULL OR requested_by_ref IS NOT NULL);
  END IF;
END $$;

-- ── food_ops ─────────────────────────────────────────────────────────────────
-- Uma linha por operacao autorizada pelo Alber Food. O nonce e UNICO (anti-repeticao da autorizacao assinada) e a idempotency_key tambem
-- (repetir o pedido devolve o resultado guardado, sem novo debito). status:
--   in_progress  reservada, ainda sem desfecho (se a funcao cair no meio, fica assim para a equipe reconciliar com a transacao)
--   completed    deu certo; result guarda a resposta devolvida
--   failed       recusada ou falhou; result guarda o erro devolvido
-- Sem policy de RLS: so a service role (Edge Functions) enxerga a tabela. Linhas com desfecho expiram (expires_at) e saem em cleanup_food_ops().

CREATE TABLE IF NOT EXISTS public.food_ops (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce               TEXT        NOT NULL,
  idempotency_key     TEXT        NOT NULL,
  kind                TEXT        NOT NULL CHECK (kind IN ('withdraw', 'set_pix_key', 'owner_transfer')),
  company_id          UUID        NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  owner_ref           TEXT        NOT NULL,
  amount_cents        BIGINT,
  destination_digest  TEXT,
  new_owner_ref       TEXT,
  status              TEXT        NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'failed')),
  result              JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  CONSTRAINT food_ops_nonce_key UNIQUE (nonce),
  CONSTRAINT food_ops_idempotency_key_key UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_food_ops_company ON public.food_ops (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_food_ops_expires ON public.food_ops (expires_at);

ALTER TABLE public.food_ops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.food_ops FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.food_ops FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Limpeza: apaga as operacoes ja encerradas e vencidas (as in_progress ficam para reconciliacao). As Edge Functions tambem limpam a cada operacao.
CREATE OR REPLACE FUNCTION public.cleanup_food_ops()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.food_ops WHERE expires_at < now() AND status <> 'in_progress';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.cleanup_food_ops() FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.cleanup_food_ops() FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- ── Funcoes do Alber Admin: owner_id/requested_by nulos ──────────────────────
-- Iguais as das migrations 056 e 057, com um unico acrescimo: o aviso in-app ao dono so e inserido quando ha usuario. CREATE OR REPLACE
-- mantem os GRANTs (so admin_app executa).

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

  -- Empresa do Alber Food (owner_id nulo): nao ha usuario do app para avisar; o Alber Food le a decisao em food-company-status.
  IF v_owner IS NOT NULL THEN
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
  END IF;

  RETURN jsonb_build_object('previous', v_previous, 'new', v_to);
END $$;

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

  -- Pedido do Alber Food (requested_by nulo): sem usuario do app para avisar; o Alber Food le a decisao em food-company-status.
  IF v_by_user IS NOT NULL THEN
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
  END IF;

  RETURN jsonb_build_object('previous', v_status, 'new', v_to, 'company_id', v_company);
END $$;
