-- ============================================================
-- Migration 066: trava no banco, empresa aprovada no KYC nao fica "em avaliacao" (12/11/2026)
-- ============================================================
--
-- O erro corrigido na 065 (aprovacao gravando so kyc_status) passou em silencio porque a regra "KYC aprovado -> conta ativa" so existia
-- no codigo. Havia dois caminhos com o mesmo defeito (company-kyc e o polling de financial-balance). Com esta constraint, qualquer
-- caminho futuro que aprove sem ativar falha na hora: o webhook responde 500 (o Asaas reenvia) e o erro fica em error_logs.
-- 'blocked' continua permitido com KYC aprovado (contencao do Admin). A 065 ja acertou as linhas existentes; a verificacao abaixo
-- garante que nao sobrou nenhuma antes de ligar a regra.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE kyc_status = 'approved' AND account_status = 'evaluation') THEN
    RAISE EXCEPTION 'Ha empresa aprovada em evaluation: rode a 065 (ou acerte os dados) antes desta migration';
  END IF;
END $$;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_approved_not_in_evaluation
  CHECK (kyc_status <> 'approved' OR account_status <> 'evaluation');
