CREATE TABLE pending_registrations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asaas_account_id  TEXT,
  asaas_api_key_enc TEXT,
  asaas_wallet_id   TEXT,
  email             TEXT,
  cpf_hash          TEXT,
  handle            TEXT,
  payload           JSONB,
  error             TEXT,
  status            TEXT DEFAULT 'pending',
  attempts          INT DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT now(),
  resolved_at       TIMESTAMPTZ
);

-- Apenas service role pode inserir/atualizar
ALTER TABLE pending_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON pending_registrations
  USING (false) WITH CHECK (false);
