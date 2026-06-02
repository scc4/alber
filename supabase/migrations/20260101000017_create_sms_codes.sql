CREATE TABLE IF NOT EXISTS public.sms_codes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  code       TEXT        NOT NULL,
  purpose    TEXT        NOT NULL CHECK (purpose IN ('pin_change', 'pix_change')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sms_codes_user_purpose ON public.sms_codes (user_id, purpose, expires_at);

ALTER TABLE public.sms_codes ENABLE ROW LEVEL SECURITY;
-- No user-facing RLS policy — access only via service role in Edge Functions
