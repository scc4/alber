-- Fecha uma operação do Alber Food que ficou presa em `in_progress` (food_ops, migration 058), para a equipe do Alber Admin reconciliar um saque
-- cujo desfecho se perdeu. Sem isto, o restaurante repete o pedido com a mesma chave, o Alber responde OPERATION_IN_PROGRESS para sempre e ele
-- não consegue mais sacar. O Admin NUNCA move dinheiro: esta função só ajusta o REGISTRO local depois que a equipe conferiu o Asaas.
--
-- Como o saque funciona (food-company-withdraw): reserva a operação (in_progress) -> grava o lançamento 'pending' com a chave de idempotência nos
-- metadados -> chama o Pix no Asaas (usando o id do lançamento como referência externa) -> grava o id da transferência e leva o lançamento a
-- 'processing'. Fica presa quando a chamada ao Asaas cai sem resposta (o Pix pode ou não ter saído) ou quando a função morre no meio.
--
-- Duas saídas, escolhidas pela equipe depois de conferir o Asaas:
--   not_sent  O Pix NÃO saiu. Vale para qualquer tipo de operação. O lançamento pendente (se houver, e ainda sem id de transferência) vai a 'failed',
--             a operação vira 'failed' com OPERATION_ABANDONED (o Food, ao repetir, recebe essa recusa e pode fazer um pedido novo).
--   sent      O Pix SAIU (só saque). Exige o id da transferência no Asaas e um lançamento pendente ainda sem esse id: liga os dois, leva o lançamento
--             a 'processing' (o webhook TRANSFER_DONE/FAILED conclui) e a operação vira 'completed' com o desfecho original.
-- Travas: só admin_app; só operação em andamento há mais de 10 minutos (uma chamada ainda viva não pode ser fechada por baixo); lançamento que já tem
-- id de transferência não pode ser dado como não enviado. Cada uso grava audit_logs 'food_op_resolved' (sem valor, chave Pix nem documento).

CREATE OR REPLACE FUNCTION public.admin_resolve_food_op(p_op_id uuid, p_outcome text, p_by text, p_transfer_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_op         public.food_ops%ROWTYPE;
  v_tx_id      uuid;
  v_tx_status  text;
  v_tx_pay     text;
  v_tx_masked  text;
  v_new        text;
BEGIN
  -- Defesa em profundidade: o GRANT é a trava principal.
  IF session_user <> 'admin_app' AND coalesce(current_setting('role', true), 'none') <> 'admin_app' THEN
    RAISE EXCEPTION 'CONTAIN_FORBIDDEN: chamador nao autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_outcome IS NULL OR p_outcome NOT IN ('not_sent', 'sent') THEN
    RAISE EXCEPTION 'CONTAIN_ACTION_INVALID: desfecho desconhecido' USING ERRCODE = '22023';
  END IF;
  IF p_op_id IS NULL OR p_by IS NULL OR btrim(p_by) = '' THEN
    RAISE EXCEPTION 'CONTAIN_ARGS_INVALID: operacao e responsavel sao obrigatorios' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'sent' AND (p_transfer_id IS NULL OR p_transfer_id !~ '^[A-Za-z0-9_-]{4,64}$') THEN
    RAISE EXCEPTION 'CONTAIN_ARGS_INVALID: informe o id da transferencia no Asaas' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_op FROM public.food_ops WHERE id = p_op_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTAIN_NOT_FOUND: operacao inexistente' USING ERRCODE = 'P0002';
  END IF;
  IF v_op.status <> 'in_progress' THEN
    RAISE EXCEPTION 'CONTAIN_INVALID_TRANSITION: so operacao em andamento pode ser encerrada' USING ERRCODE = '22023';
  END IF;
  IF v_op.created_at > now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'CONTAIN_TOO_RECENT: a operacao ainda pode estar em execucao; espere 10 minutos' USING ERRCODE = '22023';
  END IF;

  -- O lançamento do saque (só saque): nasce antes do Pix, com a chave de idempotência nos metadados.
  IF v_op.kind = 'withdraw' THEN
    SELECT t.id, t.status, t.asaas_payment_id, t.metadata ->> 'destination_masked'
      INTO v_tx_id, v_tx_status, v_tx_pay, v_tx_masked
      FROM public.transactions t
     WHERE t.company_id = v_op.company_id AND t.type = 'descarregar' AND t.metadata ->> 'idempotency_key' = v_op.idempotency_key
     FOR UPDATE;
  END IF;

  IF p_outcome = 'not_sent' THEN
    IF v_tx_id IS NOT NULL THEN
      -- Com id de transferência (ou já concluído) existe Pix no Asaas: não se pode dar como não enviado.
      IF v_tx_pay IS NOT NULL OR v_tx_status NOT IN ('pending', 'failed') THEN
        RAISE EXCEPTION 'CONTAIN_INVALID_TRANSITION: o lancamento ja tem transferencia; use o desfecho enviado' USING ERRCODE = '22023';
      END IF;
      UPDATE public.transactions SET status = 'failed' WHERE id = v_tx_id AND status = 'pending';
    END IF;
    UPDATE public.food_ops
       SET status = 'failed',
           result = jsonb_build_object('ok', false, 'status', 409, 'code', 'OPERATION_ABANDONED',
                                       'message', 'Operação encerrada pela equipe: o Pix não foi enviado. Faça um novo pedido.'),
           completed_at = now()
     WHERE id = p_op_id;
    v_new := 'failed';
  ELSE
    IF v_op.kind <> 'withdraw' THEN
      RAISE EXCEPTION 'CONTAIN_INVALID_TRANSITION: so saque tem transferencia' USING ERRCODE = '22023';
    END IF;
    IF v_tx_id IS NULL THEN
      RAISE EXCEPTION 'CONTAIN_NOT_FOUND: nao ha lancamento para ligar a transferencia' USING ERRCODE = 'P0002';
    END IF;
    IF v_tx_pay IS NOT NULL OR v_tx_status <> 'pending' THEN
      RAISE EXCEPTION 'CONTAIN_INVALID_TRANSITION: o lancamento ja foi ligado ou concluido' USING ERRCODE = '22023';
    END IF;
    UPDATE public.transactions SET status = 'processing', asaas_payment_id = p_transfer_id WHERE id = v_tx_id;
    UPDATE public.food_ops
       SET status = 'completed',
           result = jsonb_build_object('ok', true, 'status', 200, 'body', jsonb_build_object(
                      'transaction_id', v_tx_id, 'status', 'processing', 'amount_cents', v_op.amount_cents, 'destination_masked', v_tx_masked)),
           completed_at = now()
     WHERE id = p_op_id;
    v_new := 'completed';
  END IF;

  INSERT INTO public.audit_logs (user_id, event_type, metadata)
  VALUES (NULL, 'food_op_resolved', jsonb_build_object('op_id', p_op_id, 'kind', v_op.kind, 'company_id', v_op.company_id, 'outcome', p_outcome,
                                                       'transaction_id', v_tx_id, 'by', left(p_by, 254)));

  RETURN jsonb_build_object('previous', 'in_progress', 'new', v_new, 'transaction_id', v_tx_id);
END $$;

REVOKE ALL ON FUNCTION public.admin_resolve_food_op(uuid, text, text, text) FROM PUBLIC;
-- No Supabase, funcoes novas em public nascem com EXECUTE para anon/authenticated/service_role: tirar explicitamente.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.admin_resolve_food_op(uuid, text, text, text) FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_app') THEN
    GRANT EXECUTE ON FUNCTION public.admin_resolve_food_op(uuid, text, text, text) TO admin_app;
  END IF;
END $$;
