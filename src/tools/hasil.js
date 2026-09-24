const fs   = require('fs');
const path = require('path');
const { pool, RUN_ID } = require('../config');
const { getQueueStatus } = require('../lib/queue-status');
const { writeEvidence } = require('../lib/evidence');

// Pemakaian: npm run hasil -- <U1|U2|U3|U4> [tahap]
// Contoh:    npm run hasil -- U1
//            npm run hasil -- U2 saat-tertahan
const [uji, tahap] = process.argv.slice(2);

const fixtures = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../fixtures/events.json'), 'utf8')
);
const ids = (kategori) => fixtures[kategori].map((e) => e.event_id);

// Himpunan ID yang diharapkan pada akhir tiap uji
const semuaUntilU2 = [...ids('normal'), ...ids('gangguan')];
const EXPECTED = {
  U1: { receipts: ids('normal'),                                        rejected: [] },
  U2: { receipts: semuaUntilU2,                                         rejected: [] },
  U3: { receipts: semuaUntilU2,                                         rejected: [] },
  U4: { receipts: [...semuaUntilU2, ...ids('valid_setelah_invalid')],   rejected: ids('invalid') },
};

// Pada U2, sebelum pemulihan worker G01-G05 memang belum tersimpan
const TAHAP_SEBELUM_PEMULIHAN = new Set(['sebelum-gangguan', 'saat-tertahan']);

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

async function main() {
  if (!EXPECTED[uji]) {
    console.error('Pemakaian: npm run hasil -- <U1|U2|U3|U4> [tahap]');
    process.exit(1);
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

  const file = writeEvidence(uji, tahap ? `hasil-${tahap}.json` : 'hasil.json', {
    uji,
    tahap:       tahap ?? null,
    run_id:      RUN_ID,
    command:     `npm run hasil -- ${[uji, tahap].filter(Boolean).join(' ')}`,
    captured_at: new Date().toISOString(),
    queue,
    receipts:    { count: receipts.rowCount, rows: receipts.rows },
    rejected:    { count: rejected.rowCount, rows: rejected.rows },
    perbandingan_id: perbandingan,
  });

  console.log(`[${uji}${tahap ? ' / ' + tahap : ''}]`);
  console.log(`  receipts : ${receipts.rowCount} (diharapkan ${diharapkan.receipts.length})`);
  console.log(`  rejected : ${rejected.rowCount} (diharapkan ${diharapkan.rejected.length})`);
  console.log(queue.error
    ? `  queue    : tidak tersedia (${queue.error})`
    : `  queue    : ready=${queue.ready} unacked=${queue.unacked} consumers=${queue.consumers}`);
  console.log(`  perbandingan ID receipts: ${perbandingan.receipts.sesuai ? 'SESUAI' : 'TIDAK SESUAI'}`);
  console.log(`  perbandingan ID rejected: ${perbandingan.rejected.sesuai ? 'SESUAI' : 'TIDAK SESUAI'}`);
  if (perbandingan.receipts.hilang.length)    console.log(`  hilang     : ${perbandingan.receipts.hilang.join(', ')}`);
  if (perbandingan.receipts.tak_diduga.length) console.log(`  tak diduga : ${perbandingan.receipts.tak_diduga.join(', ')}`);
  console.log(`  disimpan : ${path.relative(process.cwd(), file)}`);

  if (!perbandingan.receipts.sesuai || !perbandingan.rejected.sesuai) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Gagal:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
