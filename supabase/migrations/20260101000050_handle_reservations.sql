-- Reserva de @handle para o Alber Food (cadastro de restaurantes em duas etapas).
--
-- O Alber Food cria a conta do restaurante só com @, e-mail e senha; a identidade Alber (CPF, PIN, perguntas) só nasce
-- quando o dono abre a conta de recebimento, dias depois. Para ninguém tomar o @ nesse intervalo, o Alber Food reserva o
-- @ aqui (função auth-reserve-handle, protegida por segredo de serviço). A reserva:
--   - bloqueia o @ para cadastro de usuário (auth-register), de empresa (company-create) e troca de @ (perfil-update-handle);
--   - só é "consumida" por quem a fez: o auth-register recebe `reserved_for` com o mesmo dono e apaga a reserva ao criar o usuário;
--   - é uma por dono (reservar outro @ solta o anterior).
-- Sem policies: só a service_role (as Edge Functions) lê e escreve.

CREATE TABLE public.handle_reservations (
  handle     TEXT PRIMARY KEY CHECK (handle ~ '^[a-z][a-z0-9_]{2,19}$' AND handle !~ '_$' AND handle !~ '__'),
  owner_ref  TEXT NOT NULL UNIQUE CHECK (char_length(owner_ref) BETWEEN 8 AND 64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.handle_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.handle_reservations FROM anon, authenticated;
