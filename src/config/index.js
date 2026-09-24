const { Pool } = require('pg');

// Konstanta topology A09 — harus konsisten di producer dan worker
const EXCHANGE    = 'appointments';
const QUEUE       = 'confirmations';
const ROUTING_KEY = 'appointment.booked';
const EXCHANGE_TYPE = 'direct';

// Koneksi PostgreSQL — baca dari .env
const pool = new Pool({
  host:     process.env.PGHOST,
  port:     process.env.PGPORT,
  database: process.env.PGDATABASE,
  user:     process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

// Identitas run pengujian — dipakai untuk memisahkan bukti antar uji
const RUN_ID = process.env.RUN_ID || 'run01';

module.exports = {
  RABBITMQ_URL: process.env.RABBITMQ_URL,
  EXCHANGE,
  QUEUE,
  ROUTING_KEY,
  EXCHANGE_TYPE,
  RUN_ID,
  pool,
};
