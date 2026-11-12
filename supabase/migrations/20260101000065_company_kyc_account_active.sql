-- ============================================================
-- Migration 065: empresa aprovada no KYC passa a ter a conta ativa (12/11/2026)
-- ============================================================
--
-- Antes: a aprovacao do KYC da empresa (_shared/company-kyc.ts, applyCompanyKyc) gravava kyc_status = 'approved' mas deixava
-- account_status em 'evaluation' para sempre. Efeitos: o Alber Admin mostrava a empresa aprovada como "Em analise", e a contencao do
-- Admin (admin_set_company_status, que so bloqueia a partir de 'active') nao conseguia bloquea-la. O dinheiro nao era afetado
-- (isOperational so recusa 'blocked').
-- Agora: a aprovacao passa a conta de 'evaluation' para 'active' (codigo). Esta migration acerta as empresas ja aprovadas.
-- 'blocked' nunca e tocado; empresa apagada (deleted_at) fica como esta.

UPDATE public.companies
   SET account_status = 'active', updated_at = now()
 WHERE kyc_status = 'approved'
   AND account_status = 'evaluation'
   AND deleted_at IS NULL;
