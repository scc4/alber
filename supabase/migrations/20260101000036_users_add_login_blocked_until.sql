-- Migration 036: bloqueio temporario de login por tentativas excessivas
--
-- Separado de account_status (que fica so para o estado financeiro
-- active/evaluation/blocked e ja tem um valor 'blocked' reservado para
-- bloqueio manual/administrativo -- conceito diferente deste aqui) e de
-- deleted_at (soft delete). Mesmo raciocinio da migration 034: nao misturar
-- semanticas diferentes no mesmo campo.
--
-- 3 PINs errados ou 2 respostas de seguranca erradas (janela de 15 min)
-- bloqueiam o login por 60 min. Desbloqueio e automatico -- basta o tempo
-- passar (ver _shared/login-lockout.ts).

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS login_blocked_until TIMESTAMPTZ;

COMMENT ON COLUMN public.users.login_blocked_until IS
  'Bloqueio temporario e automatico de login por tentativas excessivas de PIN/pergunta de seguranca. NULL ou no passado = nao bloqueado. Ver _shared/login-lockout.ts.';
