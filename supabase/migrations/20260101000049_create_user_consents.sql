-- Migration 049: user_consents
--
-- Contrato BaaS Asaas cl. 8.2.4: a Tomadora deve manter registro de aceite e a
-- integridade do conteudo apresentado ao cliente final (Termos, Privacidade,
-- chave Pix aleatoria, mandato). Ate aqui o aceite so existia como um boolean
-- validado no auth-register, sem prova de versao, data ou origem.
--
-- Tabela append-only: uma linha por aceite. Revogar/renovar = nova linha.
-- Escrita exclusiva do BFF (service role); o usuario so le os proprios registros.

CREATE TABLE public.user_consents (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES public.users (id),

  -- Tipos em uso hoje: terms_of_use | privacy_policy | majority
  -- Reservados (cl. 8.2.4, ainda sem tela): pix_random_key | asaas_terms |
  -- asaas_privacy | mandate
  consent_type     TEXT        NOT NULL CHECK (consent_type IN (
                      'terms_of_use', 'privacy_policy', 'majority',
                      'pix_random_key', 'asaas_terms', 'asaas_privacy', 'mandate'
                    )),

  -- Versao do documento exibido (ex.: data da "Ultima atualizacao" do texto).
  -- 'legacy-client' = app antigo que so enviou terms_accepted:true, sem versao.
  document_version TEXT        NOT NULL,

  -- SHA-256 (hex) do texto exibido ao usuario no momento do aceite, calculado
  -- no app. NULL quando o cliente nao enviou (app antigo).
  document_hash    TEXT        CHECK (document_hash IS NULL OR document_hash ~ '^[a-f0-9]{64}$'),

  accepted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address       TEXT,
  user_agent       TEXT
);

CREATE INDEX idx_user_consents_user_type
  ON public.user_consents (user_id, consent_type, accepted_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_consents_select_own ON public.user_consents
  FOR SELECT
  USING (user_id = public.auth_user_id());

-- INSERT/UPDATE/DELETE: nenhuma policy -> bloqueado para roles normais.
-- Inserido exclusivamente pelo BFF (Edge Functions) com service role.

-- ── Imutabilidade ────────────────────────────────────────────────────────────
-- Nem o service role deve alterar ou apagar prova de aceite por engano.

CREATE OR REPLACE FUNCTION public.user_consents_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'user_consents e append-only (cl. 8.2.4 do contrato BaaS)';
END;
$$;

CREATE TRIGGER user_consents_no_update_delete
  BEFORE UPDATE OR DELETE ON public.user_consents
  FOR EACH ROW EXECUTE FUNCTION public.user_consents_immutable();

COMMENT ON TABLE public.user_consents IS
  'Prova de aceite (append-only) de termos e consentimentos exigidos pelo contrato BaaS Asaas cl. 8.2.4.';
