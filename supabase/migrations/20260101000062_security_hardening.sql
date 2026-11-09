-- ============================================================
-- Migration 062: endurecimento de seguranca (auditoria de 09/11/2026)
-- ============================================================
--
-- A1  Colunas sensiveis (CPF, chaves cifradas do Asaas, carteira, chave Pix, codigos SMS) eram legiveis por `anon` e
--     `authenticated` via PostgREST. O RLS e por LINHA: as politicas que deixam participantes de um split, membros de um
--     lounge e o master de uma empresa verem OUTROS usuarios entregavam a linha inteira. Agora o acesso direto e por coluna.
-- M3  Recursao infinita entre as politicas de `companies` e `company_operators` (42P17): trocada por funcoes
--     SECURITY DEFINER sem argumento (leem as tabelas sem passar pelo RLS).
-- M2  `get_user_space_ids(uid)` / `get_user_split_ids(uid)` eram SECURITY DEFINER, executaveis por `anon` e aceitavam um `uid`
--     qualquer. Agora so respondem para o proprio usuario. (As duas existem em producao mas nao estavam em nenhuma
--     migration: o CREATE OR REPLACE abaixo tambem fecha essa deriva.)
-- W   Escrita direta via API: nenhum cliente escreve pelo REST (o app so le; escreve pelas Edge Functions, que usam service_role).
--     Revoga INSERT/UPDATE/DELETE/TRUNCATE de anon e authenticated, exceto push_tokens (politica `push_tokens_own`).
--
-- As Edge Functions usam service_role e nao sao afetadas. O app le de `users` so `id`, `name`, `handle` (e `onboarding_url` do
-- PROPRIO usuario/empresa, agora por get_my_onboarding_url() / get_my_company_onboarding_url()).

-- ── M2: lookup so do proprio usuario ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_user_space_ids(uid uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT space_id FROM public.space_members
  WHERE user_id = uid AND status = 'active' AND uid = public.auth_user_id()
$$;

CREATE OR REPLACE FUNCTION public.get_user_split_ids(uid uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT split_id FROM public.split_participants
  WHERE user_id = uid AND uid = public.auth_user_id()
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_space_ids(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_split_ids(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_user_space_ids(uuid) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_user_split_ids(uuid) TO authenticated, service_role;

-- ── Deriva: politicas de leitura de splits, lounges e usuarios ──────────────
-- Em producao estas politicas foram ajustadas a mao (usam get_user_space_ids / get_user_split_ids para nao se referenciarem em ciclo) e
-- nenhuma migration refletia isso: um banco novo, construido so das migrations, dava "infinite recursion detected in policy" em
-- splits, spaces e split_participants. As definicoes abaixo sao as de PRODUCAO em 09/11/2026 (identicas la: DROP + CREATE no-op).

DROP POLICY IF EXISTS event_batches_select ON public.event_batches;
CREATE POLICY event_batches_select ON public.event_batches AS PERMISSIVE FOR SELECT TO public
  USING ((event_id IN ( SELECT events.id
   FROM events)));

DROP POLICY IF EXISTS event_tickets_select_own ON public.event_tickets;
CREATE POLICY event_tickets_select_own ON public.event_tickets AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = auth_user_id()));

DROP POLICY IF EXISTS events_select_member ON public.events;
CREATE POLICY events_select_member ON public.events AS PERMISSIVE FOR SELECT TO public
  USING ((space_id IN ( SELECT space_members.space_id
   FROM space_members
  WHERE ((space_members.user_id = auth_user_id()) AND (space_members.status = 'active'::text)))));

DROP POLICY IF EXISTS events_select_public ON public.events;
CREATE POLICY events_select_public ON public.events AS PERMISSIVE FOR SELECT TO authenticated
  USING (((visibility = 'public'::text) AND (status = 'active'::text)));

DROP POLICY IF EXISTS lounge_messages_select_member ON public.lounge_messages;
CREATE POLICY lounge_messages_select_member ON public.lounge_messages AS PERMISSIVE FOR SELECT TO public
  USING ((space_id IN ( SELECT space_members.space_id
   FROM space_members
  WHERE ((space_members.user_id = auth_user_id()) AND (space_members.status = 'active'::text)))));

DROP POLICY IF EXISTS space_members_select_as_manager ON public.space_members;
CREATE POLICY space_members_select_as_manager ON public.space_members AS PERMISSIVE FOR SELECT TO public
  USING (((user_id = auth_user_id()) OR (space_id IN ( SELECT spaces.id
   FROM spaces
  WHERE (spaces.owner_id = auth_user_id())))));

DROP POLICY IF EXISTS space_members_select_own ON public.space_members;
CREATE POLICY space_members_select_own ON public.space_members AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = auth_user_id()));

DROP POLICY IF EXISTS spaces_select_member ON public.spaces;
CREATE POLICY spaces_select_member ON public.spaces AS PERMISSIVE FOR SELECT TO public
  USING (((owner_id = auth_user_id()) OR (id IN ( SELECT get_user_space_ids(auth_user_id()) AS get_user_space_ids))));

DROP POLICY IF EXISTS spaces_select_open ON public.spaces;
CREATE POLICY spaces_select_open ON public.spaces AS PERMISSIVE FOR SELECT TO authenticated
  USING (((type = 'open'::text) AND (status = 'active'::text)));

DROP POLICY IF EXISTS split_items_select ON public.split_items;
CREATE POLICY split_items_select ON public.split_items AS PERMISSIVE FOR SELECT TO public
  USING ((split_id IN ( SELECT split_participants.split_id
   FROM split_participants
  WHERE (split_participants.user_id = auth_user_id())
UNION ALL
 SELECT splits.id
   FROM splits
  WHERE (splits.owner_id = auth_user_id()))));

DROP POLICY IF EXISTS split_participants_select_as_owner ON public.split_participants;
CREATE POLICY split_participants_select_as_owner ON public.split_participants AS PERMISSIVE FOR SELECT TO public
  USING (((user_id = auth_user_id()) OR (split_id IN ( SELECT splits.id
   FROM splits
  WHERE (splits.owner_id = auth_user_id())))));

DROP POLICY IF EXISTS split_participants_select_own ON public.split_participants;
CREATE POLICY split_participants_select_own ON public.split_participants AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = auth_user_id()));

DROP POLICY IF EXISTS splits_select_owner ON public.splits;
CREATE POLICY splits_select_owner ON public.splits AS PERMISSIVE FOR SELECT TO public
  USING ((owner_id = auth_user_id()));

DROP POLICY IF EXISTS splits_select_participant ON public.splits;
CREATE POLICY splits_select_participant ON public.splits AS PERMISSIVE FOR SELECT TO public
  USING (((owner_id = auth_user_id()) OR (id IN ( SELECT get_user_split_ids(auth_user_id()) AS get_user_split_ids))));

DROP POLICY IF EXISTS users_select_own ON public.users;
CREATE POLICY users_select_own ON public.users AS PERMISSIVE FOR SELECT TO public
  USING ((auth_id = auth.uid()));

DROP POLICY IF EXISTS users_select_space_members ON public.users;
CREATE POLICY users_select_space_members ON public.users AS PERMISSIVE FOR SELECT TO public
  USING ((id IN ( SELECT sm.user_id
   FROM space_members sm
  WHERE (sm.space_id IN ( SELECT space_members.space_id
           FROM space_members
          WHERE ((space_members.user_id = auth_user_id()) AND (space_members.status = 'active'::text)))))));

DROP POLICY IF EXISTS users_select_split_participants ON public.users;
CREATE POLICY users_select_split_participants ON public.users AS PERMISSIVE FOR SELECT TO public
  USING ((id IN ( SELECT sp.user_id
   FROM split_participants sp
  WHERE (sp.split_id IN ( SELECT split_participants.split_id
           FROM split_participants
          WHERE (split_participants.user_id = auth_user_id()))))));

-- ── M3: politicas de empresa sem recursao ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.my_owned_company_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.companies WHERE owner_id = public.auth_user_id()
$$;

CREATE OR REPLACE FUNCTION public.my_operated_company_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.company_operators
  WHERE user_id = public.auth_user_id() AND status = 'active'
$$;

CREATE OR REPLACE FUNCTION public.my_statement_company_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.company_operators
  WHERE user_id = public.auth_user_id() AND status = 'active' AND ((permissions ->> 'ver_extrato')::boolean) IS TRUE
$$;

CREATE OR REPLACE FUNCTION public.my_company_operator_user_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT co.user_id FROM public.company_operators co
  JOIN public.companies c ON c.id = co.company_id
  WHERE c.owner_id = public.auth_user_id()
$$;

REVOKE EXECUTE ON FUNCTION public.my_owned_company_ids(), public.my_operated_company_ids(),
                           public.my_statement_company_ids(), public.my_company_operator_user_ids() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_owned_company_ids(), public.my_operated_company_ids(),
                           public.my_statement_company_ids(), public.my_company_operator_user_ids() TO authenticated, service_role;

DROP POLICY IF EXISTS companies_select_operator ON public.companies;
CREATE POLICY companies_select_operator ON public.companies
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.my_operated_company_ids()));

DROP POLICY IF EXISTS company_operators_select_as_master ON public.company_operators;
CREATE POLICY company_operators_select_as_master ON public.company_operators
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.my_owned_company_ids()));

DROP POLICY IF EXISTS transactions_select_company_master ON public.transactions;
CREATE POLICY transactions_select_company_master ON public.transactions
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.my_owned_company_ids()));

DROP POLICY IF EXISTS transactions_select_company_operator ON public.transactions;
CREATE POLICY transactions_select_company_operator ON public.transactions
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.my_statement_company_ids()));

DROP POLICY IF EXISTS users_select_company_operators_as_master ON public.users;
CREATE POLICY users_select_company_operators_as_master ON public.users
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.my_company_operator_user_ids()));

-- ── A1: acesso direto por coluna ─────────────────────────────────────────────

-- O proprio link de cadastro/KYC (antes: GET /rest/v1/users?select=onboarding_url). So o do proprio usuario.
CREATE OR REPLACE FUNCTION public.get_my_onboarding_url()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT onboarding_url FROM public.users WHERE id = public.auth_user_id()
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_onboarding_url() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_my_onboarding_url() TO authenticated, service_role;

-- Idem para a empresa: dono ou operador ativo (as mesmas pessoas que a politica companies_select_* deixava ler).
CREATE OR REPLACE FUNCTION public.get_my_company_onboarding_url(p_company_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.onboarding_url FROM public.companies c
  WHERE c.id = p_company_id
    AND (c.owner_id = public.auth_user_id() OR c.id IN (SELECT public.my_operated_company_ids()))
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_company_onboarding_url(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_my_company_onboarding_url(uuid) TO authenticated, service_role;

-- users: o app so le id, name, handle (as juncoes de lounge e split). `auth_id` entra porque `users_select_own` o usa.
REVOKE SELECT ON public.users FROM anon, authenticated;
GRANT  SELECT (id, auth_id, name, handle) ON public.users TO authenticated;

-- companies: nenhuma leitura direta do app. So as colunas que as politicas avaliam.
REVOKE SELECT ON public.companies FROM anon, authenticated;
GRANT  SELECT (id, owner_id) ON public.companies TO authenticated;

-- security_questions: o app nunca le (a pergunta vem de auth-question). Hash e resposta nunca saem.
REVOKE SELECT ON public.security_questions FROM anon, authenticated;
GRANT  SELECT (id, user_id, question, position, created_at) ON public.security_questions TO authenticated;

-- Tabelas so de servico: nenhum acesso por anon/authenticated.
REVOKE ALL ON public.sms_codes, public.pending_registrations, public.error_logs FROM anon, authenticated;

-- ── W: sem escrita direta pela API ───────────────────────────────────────────

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT  INSERT, UPDATE, DELETE ON public.push_tokens TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
