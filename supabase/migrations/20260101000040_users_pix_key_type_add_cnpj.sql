-- ============================================================
-- Migration 040: pix_key_type aceita 'cnpj'
-- Plano CNPJ (velvet-puzzling-sedgewick)
-- ============================================================
--
-- Uma empresa pode querer registrar uma chave Pix baseada no próprio CNPJ.
-- pix_key_type é usado hoje só em users (chave de saque da pessoa física);
-- mantém-se aqui porque `companies` ainda não tem chave de saque própria
-- nesta fase — adicionar o valor já deixa o CHECK pronto para quando isso
-- for implementado, sem quebrar nada do fluxo pessoal existente.

ALTER TABLE public.users
  DROP CONSTRAINT users_pix_key_type_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_pix_key_type_check
  CHECK (pix_key_type IN ('cpf', 'phone', 'email', 'random', 'cnpj'));
