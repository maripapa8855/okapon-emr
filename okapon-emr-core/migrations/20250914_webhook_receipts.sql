CREATE TABLE IF NOT EXISTS webhook_receipts (
  id               bigserial PRIMARY KEY,
  source           text NOT NULL,
  event            text NOT NULL,
  idempotency_key  text NOT NULL UNIQUE,
  payload          jsonb NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  client_ip        text,
  processed_at     timestamptz,
  error_message    text
);

CREATE INDEX IF NOT EXISTS idx_webhook_receipts_event ON webhook_receipts (event);
CREATE INDEX IF NOT EXISTS idx_webhook_receipts_received_at ON webhook_receipts (received_at);
