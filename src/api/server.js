const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const amqp    = require('amqplib');
const {
  RABBITMQ_URL,
  EXCHANGE,
  ROUTING_KEY,
  EXCHANGE_TYPE,
  RUN_ID,
  pool,
} = require('../config');
const { getQueueStatus } = require('../lib/queue-status');
const { saveInputIds }   = require('../lib/evidence');

const PORT = process.env.PORT || 3000;

// Fixtures dibaca sekali saat startup — sama dengan yang dipakai publish.js
const fixtures = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../fixtures/events.json'), 'utf8')
);
const KATEGORI_VALID = Object.keys(fixtures);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../public')));

// POST /api/publish/:kategori — publish semua event fixture kategori terkait
app.post('/api/publish/:kategori', async (req, res) => {
  const { kategori } = req.params;
  const events = fixtures[kategori];

  if (!events) {
    return res.status(400).json({
      error: `Kategori tidak dikenal. Pilihan: ${KATEGORI_VALID.join(' | ')}`,
    });
  }

  let conn, ch;
  try {
    conn = await amqp.connect(RABBITMQ_URL);
    ch   = await conn.createConfirmChannel();
    await ch.assertExchange(EXCHANGE, EXCHANGE_TYPE, { durable: true });

    const published = [];
    for (const event of events) {
      const sent = ch.publish(
        EXCHANGE,
        ROUTING_KEY,
        Buffer.from(JSON.stringify(event)),
        { persistent: true, contentType: 'application/json' }
      );
      if (!sent) throw new Error(`Buffer penuh saat publish ${event.event_id}`);
      await ch.waitForConfirms();
      published.push(event.event_id);
    }

    saveInputIds({
      kategori,
      eventIds: published,
      source:   'api',
      command:  `POST /api/publish/${kategori}`,
      runId:    RUN_ID,
    });

    res.json({ kategori, count: published.length, event_ids: published });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (ch)   await ch.close().catch(() => {});
    if (conn) await conn.close().catch(() => {});
  }
});

// GET /api/receipts — semua receipt tersimpan
app.get('/api/receipts', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT event_id, appointment_id, slot, status, processed_at
       FROM receipts
       ORDER BY processed_at DESC`
    );
    res.json({ count: result.rowCount, rows: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rejected — semua pesan yang ditolak
app.get('/api/rejected', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT event_id, reason, rejected_at
       FROM rejected
       ORDER BY rejected_at DESC`
    );
    res.json({ count: result.rowCount, rows: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/queue-status — status queue "confirmations" via RabbitMQ Management API
app.get('/api/queue-status', async (req, res) => {
  try {
    res.json(await getQueueStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reset — kosongkan receipts + rejected
app.post('/api/reset', async (req, res) => {
  try {
    await pool.query('TRUNCATE receipts, rejected RESTART IDENTITY');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server siap di http://localhost:${PORT}`);
});
