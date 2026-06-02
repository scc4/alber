-- Fluxo receber: o recebedor precisa ler o texto das perguntas do pagador.
-- Adicionamos política permissiva de leitura para qualquer usuário autenticado,
-- mas protegemos answer_hash revogando o SELECT em nível de coluna para o role
-- authenticated (service_role mantém acesso completo via bypass de RLS/grants).

-- Política: qualquer autenticado pode ler qualquer linha (só o texto da pergunta)
CREATE POLICY security_questions_select_any
  ON public.security_questions
  FOR SELECT
  TO authenticated
  USING (true);

-- Proteção de coluna: revogar SELECT de tabela e re-grant apenas nas colunas seguras.
-- Isso impede que authenticated leia answer_hash via PostgREST ou JS client.
REVOKE SELECT ON public.security_questions FROM authenticated;
GRANT SELECT (id, user_id, question, position, created_at)
  ON public.security_questions TO authenticated;
