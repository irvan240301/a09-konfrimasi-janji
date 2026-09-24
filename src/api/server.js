const express = require('express');
const path    = require('path');
const { RUN_ID, pool } = require('../config');
const { getQueueStatus } = require('../lib/queue-status');
const { publishEvents }  = require('../lib/publisher');
const { saveInputIds }   = require('../lib/evidence');
const { sebelumPublish, mulaiPemantauan, ambilRiwayat } = require('../lib/perekam');
const { KATEGORI, buatEvents } = require('../lib/events');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, '../../public')));

// POST /api/publish/:kategori — bangkitkan dan publish event uji kategori terkait
app.post('/api/publish/:kategori', async (req, res) => {
  const { kategori } = req.params;
  const events = buatEvents(kategori, RUN_ID);

  if (!events) {
    return res.status(400).json({
      error: `Kategori tidak dikenal. Pilihan: ${KATEGORI.join(' | ')}`,
    });
  }

  try {
    await sebelumPublish(kategori);

    const published = await publishEvents(events);

    saveInputIds({
      kategori,
      events,
      source:  'api',
      command: `POST /api/publish/${kategori}`,
      runId:   RUN_ID,
    });

    mulaiPemantauan(kategori);

    res.json({ kategori, count: published.length, event_ids: published });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

// GET /api/evidence-log — riwayat perekaman evidence otomatis (terbaru di atas)
app.get('/api/evidence-log', (req, res) => {
  res.json({ rows: ambilRiwayat() });
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
