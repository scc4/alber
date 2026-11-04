-- Guarda de saida do dinheiro de empresa (supabase/functions/_shared/withdraw-guard.ts): limites por idade da empresa e espera depois de
-- cadastrar uma chave Pix de saque aleatoria.
--   kyc_approved_at:    quando o Asaas aprovou a empresa (os primeiros 30 dias tem limites menores). Sem data = tratada como nova.
--   pix_key_changed_at: quando a chave Pix de saque ALEATORIA foi cadastrada (a chave so e gravada uma vez; a do tipo CNPJ nao conta). Saques ficam 48 h bloqueados.

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS kyc_approved_at TIMESTAMPTZ;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS pix_key_changed_at TIMESTAMPTZ;

-- Empresas ja aprovadas: a data da aprovacao e a da ultima atualizacao (melhor aproximacao disponivel).
UPDATE public.companies SET kyc_approved_at = updated_at WHERE kyc_status = 'approved' AND kyc_approved_at IS NULL;
