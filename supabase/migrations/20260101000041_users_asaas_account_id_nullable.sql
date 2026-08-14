-- ============================================================
-- Migration 041: users.asaas_account_id passa a ser opcional
-- Plano CNPJ (velvet-puzzling-sedgewick) — master/operador de empresa
-- ============================================================
--
-- Até aqui, todo `users` era obrigatoriamente também uma subconta Asaas
-- pessoal (CPF) — auth-register sempre criava as duas coisas juntas. Isso
-- força quem só quer ser master/operador de uma empresa a também abrir (e
-- manter) uma carteira pessoal que talvez nunca use.
--
-- `users` passa a representar só identidade/login (CPF para unicidade e
-- dono do PIN, nome, perguntas de segurança) — ter carteira pessoal
-- (subconta Asaas) vira opcional. `asaas_account_id IS NULL` = pessoa sem
-- carteira pessoal (só master/operador de empresas).

ALTER TABLE public.users
  ALTER COLUMN asaas_account_id DROP NOT NULL;

-- asaas_wallet_id e asaas_api_key_enc já eram nullable — nada a mudar ali.
