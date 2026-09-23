-- Tabel efek bisnis: satu receipt per event konfirmasi
CREATE TABLE IF NOT EXISTS receipts (
  event_id       TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL,
  customer_id    TEXT,
  slot           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'CONFIRMED_SIMULATION',
  run_id         TEXT NOT NULL,
  occurred_at    TIMESTAMPTZ,
  processed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabel jalur terminal: pesan tidak valid (X01)
CREATE TABLE IF NOT EXISTS rejected (
  id          BIGSERIAL PRIMARY KEY,
  event_id    TEXT,
  payload     JSONB,
  reason      TEXT NOT NULL,
  run_id      TEXT,
  rejected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);