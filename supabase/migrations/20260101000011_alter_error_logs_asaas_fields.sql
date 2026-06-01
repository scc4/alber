-- Adiciona campos de recuperação do Asaas ao error_logs
-- Necessário para diagnosticar falhas onde a subconta Asaas foi criada
-- mas o insert no Supabase falhou (auth user, users table, ou security_questions)

ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS asaas_account_id TEXT;
ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS asaas_response   JSONB;
