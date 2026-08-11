-- ============================================================
-- Migration 037: remove políticas de UPDATE sem restrição de coluna
-- Auditoria de segurança (2026-08-11), item 3 (RLS)
-- ============================================================
--
-- users_update_own (migration 001) e spaces_update_owner (migration 005)
-- liberavam UPDATE em QUALQUER coluna da própria linha para o dono,
-- incluindo campos que só deveriam mudar via Edge Function/service role
-- (kyc_status, account_status, asaas_wallet_id, asaas_api_key_enc,
-- login_blocked_until, cpf, asaas_account_id, status).
--
-- Nenhuma tela do app faz UPDATE direto em `users` ou `spaces` — todo
-- fluxo já passa pelas Edge Functions (que usam service role e bypassam
-- RLS). Remover a policy fecha o acesso direto via REST API sem quebrar
-- nada do app.

DROP POLICY IF EXISTS users_update_own    ON public.users;
DROP POLICY IF EXISTS spaces_update_owner ON public.spaces;
