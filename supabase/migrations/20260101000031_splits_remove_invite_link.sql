-- Spec: /specs/06_modules/split.md §3 — participantes agora são fixados na
-- criação do split; remove o mecanismo de convite por link/entrada depois.

DROP FUNCTION IF EXISTS public.get_split_preview(TEXT);

DROP INDEX IF EXISTS idx_splits_invite_token;

ALTER TABLE public.splits
  DROP COLUMN IF EXISTS invite_token,
  DROP COLUMN IF EXISTS invite_expires_at;
