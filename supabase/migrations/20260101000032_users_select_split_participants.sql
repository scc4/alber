-- Migration 032: participantes de um split podem ver o perfil público uns dos outros
-- Necessário para que o join split_participants→users(name,handle) retorne dados via
-- PostgREST — mesmo padrão da migration 025 (users_select_space_members), agora para
-- split_participants. Sem filtro de status: mesmo um participante 'pending' precisa
-- ver o nome do dono e dos demais para decidir se aprova o convite.

CREATE POLICY users_select_split_participants ON public.users
  FOR SELECT
  USING (
    id IN (
      SELECT sp.user_id
      FROM   public.split_participants sp
      WHERE  sp.split_id IN (
        SELECT split_id
        FROM   public.split_participants
        WHERE  user_id = public.auth_user_id()
      )
    )
  );
