-- ============================================================
-- Migration 067: apaga do projeto do Alber o que sobrou do Alber Food de antes da separacao (spec 10, fase 7)
-- ============================================================
--
-- Desde o corte de 11/11/2026 o Alber Food roda no projeto Supabase proprio (`alber-food`). O que ficou aqui e copia morta, congelada
-- no corte (spec 10, D1 = comecar do zero): o schema `takeaway` (dados de teste), o schema `food_admin` (views da API administrativa)
-- e os papeis `takeaway_app` (com LOGIN) e `food_admin_api`. As funcoes `food-api`/`food-admin` e os segredos so do Food ja sairam do
-- projeto em 14/11/2026, e as ultimas views do Admin que liam o `takeaway` sairam na migration 0033 do Admin (14/11/2026).
--
-- Conferido em producao em 15/11/2026, so leitura: nada fora de `takeaway`/`food_admin` depende deles (views, FKs, funcoes, tipos,
-- publicacoes, pg_cron); `anon`/`authenticated`/`service_role` sem USAGE; a API REST expoe so `public` e `graphql_public`; nenhuma
-- conexao do `takeaway_app`; os dois papeis so tem privilegios e politicas dentro desses dois schemas.
--
-- O bucket `menu-images` (imagens de teste de 09/11) NAO sai aqui: o Supabase recusa apagar storage por SQL. Apague pela API ou
-- pelo painel (spec 10, fase 7).
--
-- Em banco sem o legado (local, verify-rls) nao faz nada. As travas abaixo param tudo se o legado deixou de estar morto.

DO $$
DECLARE
  deps text;
BEGIN
  IF to_regnamespace('takeaway') IS NOT NULL THEN
    -- Algo de outro schema depende do takeaway ou do food_admin? (DROP ... CASCADE apagaria junto, em silencio.)
    SELECT string_agg(DISTINCT dn.nspname || '.' || dc.relname, ', ') INTO deps
      FROM pg_depend d
      JOIN pg_rewrite r ON r.oid = d.objid
      JOIN pg_class dc ON dc.oid = r.ev_class
      JOIN pg_namespace dn ON dn.oid = dc.relnamespace
      JOIN pg_class rc ON rc.oid = d.refobjid
      JOIN pg_namespace rn ON rn.oid = rc.relnamespace
     WHERE rn.nspname IN ('takeaway', 'food_admin')
       AND dn.nspname NOT IN ('takeaway', 'food_admin');
    IF deps IS NOT NULL THEN
      RAISE EXCEPTION 'Objetos fora do legado do Food dependem dele: %. Tire a dependencia antes desta migration.', deps;
    END IF;

    -- O schema tem de estar congelado: escrita depois do corte quer dizer que alguem ainda usa esta copia.
    IF EXISTS (SELECT 1 FROM takeaway.orders WHERE created_at >= '2026-11-12')
       OR EXISTS (SELECT 1 FROM takeaway.audit_logs WHERE created_at >= '2026-11-12') THEN
      RAISE EXCEPTION 'O takeaway deste projeto recebeu escrita depois do corte (11/11/2026): confira quem usa antes de apagar.';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename IN ('takeaway_app', 'food_admin_api')) THEN
    RAISE EXCEPTION 'Ha conexao aberta com takeaway_app/food_admin_api: confira quem ainda usa o banco antigo do Food.';
  END IF;
END $$;

DROP SCHEMA IF EXISTS food_admin CASCADE;
DROP SCHEMA IF EXISTS takeaway CASCADE;

-- Sem os schemas, os papeis nao tem mais nada (privilegios e politicas eram so la). Se sobrar algo, o DROP ROLE falha e desfaz tudo.
DROP ROLE IF EXISTS food_admin_api;
DROP ROLE IF EXISTS takeaway_app;
