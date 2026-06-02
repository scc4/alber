ALTER TABLE public.sms_codes
  DROP CONSTRAINT IF EXISTS sms_codes_purpose_check;

ALTER TABLE public.sms_codes
  ADD CONSTRAINT sms_codes_purpose_check
  CHECK (purpose IN ('pin_change', 'pix_change', 'forgot_pin'));
