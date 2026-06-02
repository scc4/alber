-- Migration 014: split_preview RPC
-- Permite visualizar split via invite_token antes de entrar.
-- Usa SECURITY DEFINER para contornar RLS (o token é a capability).
-- Spec: /specs/06_modules/split.md §4

CREATE OR REPLACE FUNCTION public.get_split_preview(p_invite_token TEXT)
RETURNS TABLE (
  id                UUID,
  name              TEXT,
  type              TEXT,
  target_amount     NUMERIC,
  max_participants  INT,
  invite_expires_at TIMESTAMPTZ,
  invite_token      TEXT,
  total_launched    NUMERIC,
  owner_handle      TEXT,
  participants      JSON
)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $$
  SELECT
    s.id,
    s.name,
    s.type,
    s.target_amount,
    s.max_participants,
    s.invite_expires_at,
    s.invite_token,
    COALESCE((
      SELECT SUM(si.value)
      FROM public.split_items si
      WHERE si.split_id = s.id
    ), 0) AS total_launched,
    u.handle AS owner_handle,
    COALESCE((
      SELECT json_agg(
        json_build_object(
          'user_id', sp.user_id,
          'status',  sp.status,
          'handle',  pu.handle,
          'name',    pu.name
        )
        ORDER BY sp.joined_at
      )
      FROM public.split_participants sp
      JOIN public.users pu ON pu.id = sp.user_id
      WHERE sp.split_id = s.id AND sp.status = 'accepted'
    ), '[]'::json) AS participants
  FROM public.splits s
  JOIN public.users u ON u.id = s.owner_id
  WHERE s.invite_token = p_invite_token
    AND s.status = 'open'
    AND s.invite_expires_at > now()
$$;

GRANT EXECUTE ON FUNCTION public.get_split_preview(TEXT) TO authenticated;
