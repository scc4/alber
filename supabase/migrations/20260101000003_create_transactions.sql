-- ============================================================
-- Migration 003: transactions
-- Spec: /specs/03_backend.md §3.3, §5.1
-- ============================================================

CREATE TABLE public.transactions (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID           NOT NULL REFERENCES public.users (id),

  type             TEXT           NOT NULL CHECK (type IN (
                                   'carregar',
                                   'descarregar',
                                   'receber',
                                   'enviar',
                                   'split_block',
                                   'split_release',
                                   'split_debit',
                                   'transferir_enviado',
                                   'transferir_recebido',
                                   'event_purchase',
                                   'event_refund',
                                   'fee'
                                 )),

  -- amount em Albers; amount_brl em Reais (paridade 1:1 no MVP, spec 04_api §5)
  amount           NUMERIC(10, 2) NOT NULL,
  amount_brl       NUMERIC(10, 2),

  -- Taxa retida (spec §5.1): fee_amount = amount * rates.type
  fee_amount       NUMERIC(10, 2) NOT NULL DEFAULT 0,

  status           TEXT           NOT NULL CHECK (status IN (
                                   'pending',
                                   'completed',
                                   'failed',
                                   'refunded'
                                 )),

  -- ID do pagamento/transferência no Asaas (para idempotência, spec 04_api §6)
  asaas_payment_id TEXT,

  -- Referência polimórfica: split_id, event_id, etc.
  reference_id     UUID,
  reference_type   TEXT,

  -- Dados extras: payer_handle, event_name, split_name, etc.
  metadata         JSONB          NOT NULL DEFAULT '{}',

  created_at       TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- ── Índices ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_transactions_user_id    ON public.transactions (user_id);
CREATE INDEX idx_transactions_created_at ON public.transactions (created_at DESC);
CREATE INDEX idx_transactions_reference  ON public.transactions (reference_id)
  WHERE reference_id IS NOT NULL;
CREATE INDEX idx_transactions_asaas_id   ON public.transactions (asaas_payment_id)
  WHERE asaas_payment_id IS NOT NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Leitura: apenas as transações do próprio usuário
CREATE POLICY transactions_select_own ON public.transactions
  FOR SELECT
  USING (user_id = public.auth_user_id());

-- INSERT / UPDATE: exclusivos ao service role
-- Toda operação financeira passa pelo BFF (Edge Functions),
-- nunca é iniciada diretamente pelo app (spec 03_backend §1)
