-- Migration 025: membros ativos de um Lounge podem ver o perfil público uns dos outros
-- Necessário para que o join space_members→users(id,name,handle) retorne dados via PostgREST
-- Colunas sensíveis (asaas_*, pix_key, cpf) já estão cifradas/hasheadas na origem

CREATE POLICY users_select_space_members ON public.users
  FOR SELECT
  USING (
    id IN (
      SELECT sm.user_id
      FROM   public.space_members sm
      WHERE  sm.space_id IN (
        SELECT space_id
        FROM   public.space_members
        WHERE  user_id  = public.auth_user_id()
        AND    status   = 'active'
      )
    )
  );
