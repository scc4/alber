-- ============================================================
-- Migration 007: rates
-- Spec: /specs/03_backend.md §3.9, §5.1
-- ============================================================

CREATE TABLE public.rates (
  id         UUID           PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificador único do tipo de taxa
  type       TEXT           UNIQUE NOT NULL,

  -- Percentual: 0.0200 = 2%, máximo permitido = 99.99%
  rate       NUMERIC(5, 4)  NOT NULL CHECK (rate >= 0 AND rate < 1),

  updated_at TIMESTAMPTZ    NOT NULL DEFAULT now(),

  -- Quem alterou a taxa (auditoria); NULL = seed inicial
  updated_by UUID           REFERENCES public.users (id)
);

CREATE TRIGGER rates_updated_at
  BEFORE UPDATE ON public.rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── Taxas padrão (spec 03_backend §5.1) ──────────────────────────────────────

INSERT INTO public.rates (type, rate) VALUES
  ('cashout', 0.0200),  -- 2%  — taxa de descarregamento (Pix externo)
  ('receber', 0.0100),  -- 1%  — taxa sobre valor recebido de outro usuário
  ('event',   0.0500);  -- 5%  — taxa sobre ingressos de eventos pagos

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.rates ENABLE ROW LEVEL SECURITY;

-- Qualquer usuário autenticado pode ler as taxas vigentes
-- (necessário para exibir fee preview na UI — spec 06_modules §carregar)
CREATE POLICY rates_select_authenticated ON public.rates
  FOR SELECT
  TO authenticated
  USING (true);

-- UPDATE / INSERT: exclusivos ao service role (painel admin, spec 08_admin_panel)
