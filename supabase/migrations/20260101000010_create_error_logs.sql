CREATE TABLE error_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function         TEXT NOT NULL,
  error_code       TEXT,
  error_msg        TEXT,
  payload          JSONB,
  asaas_account_id TEXT,
  asaas_response   JSONB,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Apenas service role pode inserir
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON error_logs
  USING (false) WITH CHECK (false);
