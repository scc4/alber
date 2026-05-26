-- ============================================================
-- Migration 008: audit_logs
-- Spec: /specs/03_backend.md §3.10, /specs/05_security.md §9
-- ============================================================

CREATE TABLE public.audit_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL permitido: eventos de sistema sem usuário identificado
  user_id     UUID        REFERENCES public.users (id),

  -- Tipos obrigatórios (spec 05_security §9):
  -- 'login_success' | 'login_failed' | 'pin_failed' | 'pin_blocked'
  -- 'security_question_failed' | 'security_question_blocked'
  -- 'pin_changed' | 'handle_changed' | 'pix_key_changed'
  -- 'pin_recovery_started' | 'pin_recovery_completed'
  -- 'cashout_initiated' | 'cashout_completed'
  -- 'pix_rejected_cpf_mismatch'
  -- 'kyc_submitted' | 'kyc_approved' | 'kyc_rejected'
  -- 'session_invalidated'
  event_type  TEXT        NOT NULL,

  ip_address  TEXT,
  device_info JSONB,

  -- Dados adicionais do evento: amount, handle anterior, etc.
  metadata    JSONB       NOT NULL DEFAULT '{}',

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Índices ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_audit_logs_user_id    ON public.audit_logs (user_id);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_event_type ON public.audit_logs (event_type);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Somente leitura pelo próprio usuário (spec 03_backend §3.10)
CREATE POLICY audit_logs_select_own ON public.audit_logs
  FOR SELECT
  USING (user_id = public.auth_user_id());

-- INSERT: exclusivo ao service role
-- Nenhuma policy de INSERT adicionada → bloqueado para roles normais
-- Todos os eventos são inseridos exclusivamente pelo BFF (Edge Functions, webhooks)
