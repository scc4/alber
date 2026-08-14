-- ============================================================
-- Migration 043: companies.handle
-- Plano CNPJ (velvet-puzzling-sedgewick) — empresa como destinatária de
-- transferência, localizável por @handle (mesmo mecanismo de busca já usado
-- para pessoa física).
-- ============================================================
--
-- Handle é escolhido no cadastro (dados-empresa.tsx), junto com os outros
-- dados da empresa — nunca editável depois disso nesta fase (mesma regra
-- informal já aplicada ao handle pessoal). Unicidade precisa valer TAMBÉM
-- cruzando com users.handle (não pode existir @foo pessoa e @foo empresa ao
-- mesmo tempo — a busca por handle em financial-transferir ficaria ambígua).
-- Esse cruzamento não é uma constraint do Postgres (tabelas diferentes) —
-- é responsabilidade da aplicação (auth-register / _shared/company.ts).

ALTER TABLE public.companies
  ADD COLUMN handle TEXT UNIQUE NOT NULL DEFAULT '';

-- O DEFAULT '' é só para permitir adicionar a coluna NOT NULL numa tabela
-- que já poderia ter linhas (não tem, nesse ambiente, mas é mais seguro) —
-- remove o default imediatamente, novos inserts sempre informam o handle.
ALTER TABLE public.companies
  ALTER COLUMN handle DROP DEFAULT;

CREATE INDEX idx_companies_handle ON public.companies (handle);
