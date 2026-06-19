-- Migration 026: adiciona asaas_customer_id na tabela users
-- Necessário para cachear o customer Asaas e evitar chamada GET /customers a cada QR gerado

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT;
