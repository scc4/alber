-- ============================================================
-- Migration 015: Add missing Lounge fields to spaces & events
-- Spec: /specs/06_modules/alber_lounge.md § 4, § 9
-- ============================================================

-- ── spaces: description, image_url, invite_token ─────────────────────────────

ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS image_url   TEXT,
  ADD COLUMN IF NOT EXISTS invite_token TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_spaces_invite_token ON public.spaces (invite_token);

-- ── events: recurrence fields ─────────────────────────────────────────────────

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS is_recurring     BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurrence_freq  TEXT
    CHECK (recurrence_freq IS NULL OR recurrence_freq IN ('daily', 'weekly', 'biweekly', 'monthly')),
  ADD COLUMN IF NOT EXISTS parent_event_id  UUID
    REFERENCES public.events(id) ON DELETE SET NULL;
