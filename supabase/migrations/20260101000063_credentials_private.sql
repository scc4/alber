-- ============================================================
-- Migration 063: credenciais fora do JWT e sem texto puro (A2 da auditoria de 09/11/2026)
-- ============================================================
--
-- Antes: o PIN era guardado como SHA-256 puro e bcrypt em auth.users.raw_app_meta_data (que o Supabase Auth inclui no JWT de
-- todo usuario) e a senha do Supabase Auth era o proprio SHA-256 do PIN; a resposta de seguranca tinha o SHA-256 puro
-- (answer_sha256) e o TEXTO NORMALIZADO em claro (answer_normalized). Um PIN de 6 digitos cai por forca bruta em milissegundos.
--
-- Agora: o PIN fica em public.user_credentials (HMAC-SHA256 com pepper do servidor + bcrypt do valor com pepper), sem nenhum
-- acesso de anon/authenticated; a senha do Supabase Auth e derivada no servidor (nunca do PIN); da resposta fica so o bcrypt do
-- valor com pepper e o texto normalizado CIFRADO (AES-GCM) para montar as opcoes mascaradas. Nao ha usuarios (public.users = 0
-- em 09/11/2026): nada para converter.

CREATE TABLE IF NOT EXISTS public.user_credentials (
  user_id    UUID        PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  pin_hmac   TEXT        NOT NULL,
  pin_bcrypt TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_credentials FROM anon, authenticated;
COMMENT ON TABLE public.user_credentials IS 'PIN do usuario: HMAC com pepper + bcrypt. So service_role (Edge Functions).';

ALTER TABLE public.security_questions ADD COLUMN IF NOT EXISTS answer_enc TEXT;
ALTER TABLE public.security_questions DROP COLUMN IF EXISTS answer_normalized;
ALTER TABLE public.security_questions DROP COLUMN IF EXISTS answer_sha256;
COMMENT ON COLUMN public.security_questions.answer_hash IS 'bcrypt(HMAC-SHA256(pepper, sha256 da resposta)); nunca a resposta.';
COMMENT ON COLUMN public.security_questions.answer_enc  IS 'Resposta normalizada cifrada (AES-256-GCM, ENCRYPTION_KEY) so para gerar as opcoes mascaradas.';
