-- Migration 022: armazena o sha256 exato usado como input do bcrypt
-- Elimina recomputação no backend (Deno vs expo-crypto podem divergir)
ALTER TABLE public.security_questions
  ADD COLUMN IF NOT EXISTS answer_sha256 TEXT;
