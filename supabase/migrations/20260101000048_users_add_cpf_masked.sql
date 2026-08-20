-- ============================================================
-- Migration 048: users.cpf_masked
-- Spec: /specs/05_security.md §7, /specs/06_modules/perfil.md §3
-- ============================================================
--
-- users.cpf é hash SHA-256 (irreversível) — não dá pra exibir uma versão
-- mascarada a partir dele. Esta coluna guarda só a versão já mascarada
-- (formato do spec: "***.***.*XX-XX"), calculada uma única vez em
-- auth-register logo antes do CPF em texto puro ser descartado. Nunca
-- guarda o CPF completo — só o suficiente pra exibição.
-- Nullable: usuários cadastrados antes desta migration ficam sem valor (UI
-- trata como estado vazio) — mesmo padrão de companies.cnpj_masked
-- (migration 047).

ALTER TABLE public.users ADD COLUMN cpf_masked TEXT;
