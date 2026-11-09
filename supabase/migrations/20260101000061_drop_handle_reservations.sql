-- O Alber Food deixou de reservar @ no Alber (P1, specs/09_responsabilidades_sistemas.md): auth-reserve-handle foi removida e
-- nenhuma função lê mais a tabela. Só continha reservas de teste.
DROP TABLE IF EXISTS public.handle_reservations;
