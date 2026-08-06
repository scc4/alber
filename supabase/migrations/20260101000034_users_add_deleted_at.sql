-- Migration 034: soft delete de conta (exigido pelas politicas Google Play/App Store)
--
-- deleted_at separado de account_status (que continua so para o estado
-- financeiro active/evaluation/blocked) para nao arriscar comportamento
-- silencioso em nenhuma comparacao existente com account_status.
--
-- Ao excluir, a Edge Function conta-excluir sobrescreve name/handle/email
-- (anonimizados) e seta deleted_at -- linha de users permanece (varias
-- tabelas financeiras/sociais nao tem ON DELETE CASCADE), mas toda leitura
-- ao vivo (busca, extrato, lounge, split) passa a mostrar o placeholder
-- automaticamente, sem precisar alterar cada Edge Function que faz join.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.users.deleted_at IS
  'Soft delete -- conta encerrada pelo usuario. Linha e dados financeiros retidos por obrigacao legal; name/handle/email sao anonimizados no momento da exclusao. auth-login bloqueia login quando nao nulo.';
