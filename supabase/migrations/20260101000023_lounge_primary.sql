-- ============================================================
-- Migration 022: lounge is_primary + status 'left'
-- Spec: /specs/06_modules/alber_lounge.md § 10 "Lounge principal"
-- ============================================================

-- Adicionar coluna is_primary em space_members
ALTER TABLE public.space_members
  ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT false;

-- Um usuário só pode ter um Lounge principal ativo por vez
CREATE UNIQUE INDEX idx_space_members_one_primary
  ON public.space_members (user_id)
  WHERE is_primary = true AND status = 'active';

-- Adicionar status 'left' (saída voluntária) ao CHECK constraint
ALTER TABLE public.space_members
  DROP CONSTRAINT space_members_status_check;

ALTER TABLE public.space_members
  ADD CONSTRAINT space_members_status_check
  CHECK (status IN ('pending', 'active', 'banned', 'left'));
