-- ============================================================
-- Migration 028: space_members — novo status 'invited'
-- Spec: /specs/06_modules/alber_lounge.md § 6/7
--
-- 'pending' já significa "usuário pediu para entrar, dono precisa aprovar"
-- (ver lounge-join / lounge-approve). Convite por handle é a direção
-- oposta — o dono convida — e não pode reusar 'pending' sob risco de
-- aparecer na fila de aprovação ou bloquear a entrada real do convidado.
-- ============================================================

DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.space_members'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%IN%';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.space_members DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.space_members
  ADD CONSTRAINT space_members_status_check
  CHECK (status IN ('pending', 'active', 'banned', 'invited'));
