require('dotenv').config();
const amqp = require('amqplib');
const {
  RABBITMQ_URL,
  EXCHANGE,
  QUEUE,
  ROUTING_KEY,
  EXCHANGE_TYPE,
  RUN_ID,
  pool,
} = require('./config');

async function main() {
  let conn, ch;
  try {
    conn = await amqp.connect(RABBITMQ_URL);
    ch   = await conn.createChannel();

    // Topology — semua durable agar tahan restart
    await ch.assertExchange(EXCHANGE, EXCHANGE_TYPE, { durable: true });
    await ch.assertQueue(QUEUE, { durable: true });
    await ch.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);

    // Ambil 1 pesan per giliran — fair dispatch
    await ch.prefetch(1);

    console.log(`Worker siap. Exchange: ${EXCHANGE} | Queue: ${QUEUE} | Run: ${RUN_ID}`);
    console.log('Menunggu pesan... (CTRL+C untuk berhenti)');

    await ch.consume(QUEUE, (msg) => handle(ch, msg), { noAck: false });
  } catch (err) {
    console.error('Worker gagal start:', err.message);
    process.exit(1);
  }
}

async function handle(ch, msg) {
  if (msg === null) return;

  let ev;

  // LANGKAH 1: Parse JSON
  try {
    ev = JSON.parse(msg.content.toString());
  } catch {
    // Pesan tidak bisa dibaca sama sekali → jalur terminal
    await pool.query(
      `INSERT INTO rejected (payload, reason, run_id)
       VALUES ($1, $2, $3)`,
      [msg.content.toString(), 'INVALID_JSON', RUN_ID]
    );
    console.log(`✗ Ditolak (INVALID_JSON) → tabel rejected`);
    return ch.ack(msg); // pesan buruk → ack, jangan requeue
  }

  const p     = ev.payload ?? {};
  const runId = (ev.event_id ?? '').split('-')[0] || RUN_ID;

  // LANGKAH 2: Validasi field wajib A09
  if (!p.appointment_id) {
    await pool.query(
      `INSERT INTO rejected (event_id, payload, reason, run_id)
       VALUES ($1, $2, $3, $4)`,
      [ev.event_id ?? null, ev, 'MISSING_appointment_id', runId]
    );
    console.log(`✗ Ditolak (MISSING_appointment_id) event_id: ${ev.event_id} → tabel rejected`);
    return ch.ack(msg); // X01: tanpa efek bisnis, tanpa requeue
  }

  // LANGKAH 3: Simpan receipt — JANTUNG IDEMPOTENCY
  try {
    const res = await pool.query(
      `INSERT INTO receipts
         (event_id, appointment_id, customer_id, slot, run_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        ev.event_id,
        p.appointment_id,
        p.customer_id ?? null,
        p.slot,
        runId,
        ev.occurred_at ?? null,
      ]
    );

    if (res.rowCount === 1) {
      console.log(`✓ Receipt tersimpan: ${ev.event_id} | apt: ${p.appointment_id} | slot: ${p.slot}`);
    } else {
      console.log(`~ Duplikat diabaikan: ${ev.event_id} (receipt sudah ada)`);
    }

    // ACK hanya setelah receipt pasti tersimpan di DB
    return ch.ack(msg);

  } catch (err) {
    // Error lingkungan (DB mati, koneksi putus) → jangan ack, requeue
    console.error(`! Error lingkungan: ${err.message} → requeue`);
    return ch.nack(msg, false, true);
  }
}

main().catch(console.error);