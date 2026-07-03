-- Add 'processing' to transactions.status allowed values.
-- Used by descarregar: Pix transfer is accepted by Asaas but awaiting
-- TRANSFER_CONFIRMED webhook before marking as 'completed'.

ALTER TABLE public.transactions
  DROP CONSTRAINT transactions_status_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded'));
