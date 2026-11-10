-- ============================================================
-- Migration 064: codigo SMS so como HMAC e com limite de tentativas (auditoria de 09/11/2026)
-- ============================================================
--
-- Antes: sms_codes.code guardava o codigo de 6 digitos em texto puro e nada limitava as tentativas de confirmacao.
-- Agora: code_hash = HMAC-SHA256 com pepper (preso ao usuario e a finalidade) e attempts conta os erros (maximo 5 por codigo).
-- Os codigos duram 10 minutos: apagar os existentes e seguro (quem estiver no meio de uma troca pede outro).

DELETE FROM public.sms_codes;
ALTER TABLE public.sms_codes ADD COLUMN code_hash TEXT NOT NULL;
ALTER TABLE public.sms_codes ADD COLUMN attempts INT NOT NULL DEFAULT 0;
ALTER TABLE public.sms_codes DROP COLUMN code;
