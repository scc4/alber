-- Spec: sino de notificações — realtime (websocket) para o badge
-- Publica a tabela notifications no canal supabase_realtime para que
-- clientes possam assinar postgres_changes (INSERT) filtrado por user_id.
-- RLS (notifications_select_own, migration 029) continua sendo aplicada
-- pelo Realtime — a publicação apenas habilita o transporte dos eventos.

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
