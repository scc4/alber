-- ============================================================
-- Migration 047: companies.cnpj_masked
-- Spec: /specs/06_modules/empresa_operadores.md, plano perfil-empresa
-- ============================================================
--
-- companies.cnpj é hash SHA-256 (irreversível, mesmo padrão de users.cpf) —
-- não dá pra exibir uma versão mascarada a partir dele. Esta coluna guarda
-- só a versão já mascarada (ex: "**.***.***/0001-81"), calculada uma única
-- vez em createCompanyForOwner logo antes do CNPJ em texto puro ser
-- descartado. Nunca guarda o CNPJ completo — só o suficiente pra exibição.
-- Nullable: empresas criadas antes desta migration ficam sem valor (UI trata
-- como estado vazio).

ALTER TABLE public.companies ADD COLUMN cnpj_masked TEXT;
