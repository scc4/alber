-- Migration 046: preferencias de notificacao por categoria (persistidas de verdade)
--
-- Perfil > Notificacoes (app/(app)/perfil/notificacoes.tsx) sempre teve esses
-- toggles, mas eram só de interface -- desligar "Split fechado" não impedia
-- nada de ser enviado. Mesmo padrão de falso-positivo do item 8 da revisão de
-- QA (screenshot), só que em notificacoes.
--
-- Categorias de "Segurança" (login novo dispositivo, troca de PIN, tentativas
-- bloqueadas) continuam sem coluna de proposito -- a UI ja os mostra fixos
-- como "sempre ligados" (nao-configuraveis), entao nao ha nada pra persistir.
--
-- notif_split_expired existe mas ainda nao tem nenhum ponto do backend que a
-- dispare (nao existe fluxo de "link de split expirado" implementado ainda)
-- -- reservada pra quando existir, default true pra nao surpreender ninguem
-- se for implementada depois.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notif_tx_receive        BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notif_tx_send           BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notif_tx_carregar       BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notif_tx_descarregar    BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notif_split_participant BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notif_split_expired     BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notif_split_closed      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notif_lounge_message    BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notif_lounge_event      BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notif_lounge_request    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notif_conta_kyc         BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.users.notif_tx_receive IS 'Push de "Recebimentos" (transferência/pagamento recebido). Checado em push-send via category=tx_receive.';
COMMENT ON COLUMN public.users.notif_tx_send IS 'Push de "Envios" (pagamento enviado). category=tx_send.';
COMMENT ON COLUMN public.users.notif_tx_carregar IS 'Push de "Carregamentos". category=tx_carregar.';
COMMENT ON COLUMN public.users.notif_tx_descarregar IS 'Push de "Saques". category=tx_descarregar.';
COMMENT ON COLUMN public.users.notif_split_participant IS 'Push de convite/entrada/lançamento em split. category=split_participant.';
COMMENT ON COLUMN public.users.notif_split_expired IS 'Reservada -- nenhum fluxo de expiração de split implementado ainda.';
COMMENT ON COLUMN public.users.notif_split_closed IS 'Push de "Split fechado". category=split_closed.';
COMMENT ON COLUMN public.users.notif_lounge_message IS 'Push de mensagem no chat de um Lounge. category=lounge_message.';
COMMENT ON COLUMN public.users.notif_lounge_event IS 'Push de evento criado/atualizado/cancelado/ingresso confirmado num Lounge. category=lounge_event.';
COMMENT ON COLUMN public.users.notif_lounge_request IS 'Push de solicitação de entrada em Lounge (dono) e sua aprovação/rejeição (solicitante). category=lounge_request.';
COMMENT ON COLUMN public.users.notif_conta_kyc IS 'Push de atualização de status de verificação KYC (pessoal ou de empresa). category=conta_kyc.';
