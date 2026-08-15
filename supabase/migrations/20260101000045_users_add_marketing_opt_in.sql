-- Migration 045: consentimento de marketing separado do aceite obrigatorio
--
-- Item 19 da revisao de QA (Consentimentos separados): o checkbox de
-- newsletter/push promocional no cadastro (cadastro/terms.tsx) precisa ficar
-- de fato registrado, distinto do aceite de Termos de Uso/Politica de
-- Privacidade (que e obrigatorio e nao tem coluna propria -- fica implicito
-- na criacao da conta). marketing_opt_in comeca false e so vira true por
-- acao explicita do usuario (no cadastro ou depois em Perfil > Notificacoes).

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS marketing_opt_in_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.users.marketing_opt_in IS
  'Consentimento opcional para receber comunicacao de marketing (e-mail/push). Default false -- nunca pre-marcado. Alteravel a qualquer momento pelo proprio usuario (perfil-update-marketing).';
COMMENT ON COLUMN public.users.marketing_opt_in_updated_at IS
  'Quando marketing_opt_in foi alterado pela ultima vez -- rastreabilidade do consentimento (LGPD).';
