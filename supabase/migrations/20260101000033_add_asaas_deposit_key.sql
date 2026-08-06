-- Migration 033: adiciona asaas_deposit_key na tabela users
--
-- Separa dois conceitos que o código vinha misturando no campo pix_key:
--   pix_key            -> chave de SAQUE, escolhida pelo usuário (cpf/phone/email/random),
--                          usada só como destino de transferência Pix externa (descarregar).
--   asaas_deposit_key  -> chave de RECEBIMENTO, sempre EVP (aleatória), registrada na própria
--                          subconta Asaas via POST /pix/addressKeys, usada para gerar o QR
--                          code de carregamento (createPixStaticQrCode). Nunca escolhida pelo
--                          usuário -- criada automaticamente pelo backend.
--
-- Antes desta migration, financial-carregar/webhooks-asaas-kyc reaproveitavam pix_key (a
-- chave de saque) como chave de recebimento, o que falha na Asaas com "Chave Pix não
-- encontrada" sempre que o usuário escolheu cpf/phone/email no cadastro (nunca registrada
-- como chave de recebimento na subconta).

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS asaas_deposit_key TEXT;

COMMENT ON COLUMN public.users.asaas_deposit_key IS
  'Chave Pix EVP de recebimento da própria subconta Asaas (criptografada com ENCRYPTION_KEY), usada em createPixStaticQrCode. Distinta de pix_key, que é a chave de saque escolhida pelo usuário.';
