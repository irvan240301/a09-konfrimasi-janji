const { pool } = require('../config');
const { rekamHasil } = require('../lib/snapshot');

// Pemakaian: npm run hasil -- <U1|U2|U3|U4> [tahap]
// Contoh:    npm run hasil -- U1
//            npm run hasil -- U2 saat-tertahan
const [uji, tahap] = process.argv.slice(2);

async function main() {
  const r = await rekamHasil(uji, tahap);
  const { receipts, rejected } = r.perbandingan;

  console.log(`[${r.uji}${r.tahap ? ' / ' + r.tahap : ''}]`);
  console.log(`  receipts : ${receipts.aktual} (diharapkan ${receipts.diharapkan})`);
  console.log(`  rejected : ${rejected.aktual} (diharapkan ${rejected.diharapkan})`);
  console.log(r.queue.error
    ? `  queue    : tidak tersedia (${r.queue.error})`
    : `  queue    : ready=${r.queue.ready} unacked=${r.queue.unacked} consumers=${r.queue.consumers}`);
  console.log(`  perbandingan ID receipts: ${receipts.sesuai ? 'SESUAI' : 'TIDAK SESUAI'}`);
  console.log(`  perbandingan ID rejected: ${rejected.sesuai ? 'SESUAI' : 'TIDAK SESUAI'}`);
  if (receipts.hilang.length)     console.log(`  hilang     : ${receipts.hilang.join(', ')}`);
  if (receipts.tak_diduga.length) console.log(`  tak diduga : ${receipts.tak_diduga.join(', ')}`);
  console.log(`  disimpan : ${r.file}`);

  if (!r.sesuai) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err.status === 400
      ? `${err.message}\nPemakaian: npm run hasil -- <U1|U2|U3|U4> [tahap]`
      : `Gagal: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
