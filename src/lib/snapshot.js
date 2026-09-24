const path = require('path');
const { pool, RUN_ID } = require('../config');
const { getQueueStatus } = require('./queue-status');
const { writeEvidence } = require('./evidence');
const { buatEvents } = require('./events');

const ROOT = path.join(__dirname, '../..');

const ids = (kategori) => buatEvents(kategori, RUN_ID).map((e) => e.event_id);

// Himpunan ID yang diharapkan pada akhir tiap uji
const sampaiU2 = [...ids('normal'), ...ids('gangguan')];
const EXPECTED = {
  U1: { receipts: ids('normal'),                                     rejected: [] },
  U2: { receipts: sampaiU2,                                          rejected: [] },
  U3: { receipts: sampaiU2,                                          rejected: [] },
  U4: { receipts: [...sampaiU2, ...ids('valid_setelah_invalid')],    rejected: ids('invalid') },
};

// Pada U2, sebelum pemulihan worker G01-G05 memang belum tersimpan
const TAHAP_SEBELUM_PEMULIHAN = new Set(['sebelum-gangguan', 'saat-tertahan']);

// tahap dipakai sebagai nama file, jadi dibatasi ke huruf/angka/strip
const TAHAP_VALID = /^[a-z0-9-]+$/i;

function inputSalah(pesan) {
  const err = new Error(pesan);
  err.status = 400;
  return err;
}

function bandingkan(diharapkan, aktual) {
  const setAktual     = new Set(aktual);
  const setDiharapkan = new Set(diharapkan);
  const hilang    = diharapkan.filter((id) => !setAktual.has(id));
  const takDiduga = aktual.filter((id) => !setDiharapkan.has(id));
  return {
    diharapkan: diharapkan.length,
    aktual:     aktual.length,
    hilang,
    tak_diduga: takDiduga,
    sesuai:     hilang.length === 0 && takDiduga.length === 0,
  };
}

// Ambil snapshot receipts/rejected/queue, bandingkan dengan ID yang diharapkan,
// lalu simpan ke evidence/<uji>/hasil[-<tahap>].json. Hanya membaca database.
async function rekamHasil(uji, tahap, source = 'cli') {
  if (!EXPECTED[uji]) {
    throw inputSalah(`Uji tidak dikenal. Pilihan: ${Object.keys(EXPECTED).join(' | ')}`);
  }
  if (tahap && !TAHAP_VALID.test(tahap)) {
    throw inputSalah('Tahap hanya boleh berisi huruf, angka, dan tanda strip');
  }

  const diharapkan = { ...EXPECTED[uji] };
  if (uji === 'U2' && TAHAP_SEBELUM_PEMULIHAN.has(tahap)) {
    diharapkan.receipts = ids('normal');
  }

  const receipts = await pool.query(
    `SELECT event_id, appointment_id, customer_id, slot, status, run_id, occurred_at, processed_at
     FROM receipts ORDER BY event_id`
  );
  const rejected = await pool.query(
    `SELECT id, event_id, reason, run_id, rejected_at, payload
     FROM rejected ORDER BY id`
  );

  let queue;
  try {
    queue = await getQueueStatus();
  } catch (err) {
    queue = { error: err.message };
  }

  const perbandingan = {
    receipts: bandingkan(diharapkan.receipts, receipts.rows.map((r) => r.event_id)),
    rejected: bandingkan(diharapkan.rejected, rejected.rows.map((r) => r.event_id).filter(Boolean)),
  };

  const absFile = writeEvidence(uji, tahap ? `hasil-${tahap}.json` : 'hasil.json', {
    uji,
    tahap:       tahap ?? null,
    run_id:      RUN_ID,
    source,
    command:     source === 'api'
      ? `POST /api/hasil/${uji}${tahap ? '?tahap=' + tahap : ''}`
      : `npm run hasil -- ${[uji, tahap].filter(Boolean).join(' ')}`,
    captured_at: new Date().toISOString(),
    queue,
    receipts:    { count: receipts.rowCount, rows: receipts.rows },
    rejected:    { count: rejected.rowCount, rows: rejected.rows },
    perbandingan_id: perbandingan,
  });

  return {
    uji,
    tahap:  tahap ?? null,
    file:   path.relative(ROOT, absFile).split(path.sep).join('/'),
    queue,
    perbandingan,
    sesuai: perbandingan.receipts.sesuai && perbandingan.rejected.sesuai,
  };
}

module.exports = { rekamHasil };
