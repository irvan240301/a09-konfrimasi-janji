const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

// Menjalankan worker apa adanya, sambil menyalin outputnya ke evidence/worker-<sesi>.log.
// Pemakaian: npm run worker:log -- <nama-sesi>   contoh: npm run worker:log -- sesi1
const sesi = process.argv[2];
if (!sesi || !/^[a-z0-9-]+$/i.test(sesi)) {
  console.error('Pemakaian: npm run worker:log -- <nama-sesi>   contoh: npm run worker:log -- sesi1');
  process.exit(1);
}

const dir = path.join(ROOT, 'evidence');
fs.mkdirSync(dir, { recursive: true });
const log = fs.createWriteStream(path.join(dir, `worker-${sesi}.log`), { flags: 'w', encoding: 'utf8' });
log.write(`# sesi ${sesi} dimulai ${new Date().toISOString()}\n`);

const child = spawn(process.execPath, ['--env-file=.env', 'src/consumers/worker.js'], {
  cwd: ROOT,
  stdio: ['inherit', 'pipe', 'pipe'],
});

// Teks diteruskan sebagai string UTF-8: terminal menampilkannya lewat API konsol
// (tidak bergantung code page) dan berkas log menyimpan byte UTF-8 yang benar.
for (const [asal, tujuan] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
  asal.setEncoding('utf8');
  asal.on('data', (teks) => {
    tujuan.write(teks);
    log.write(teks);
  });
}

// CTRL+C juga sampai ke worker; pembungkus menunggu worker selesai agar log tertutup rapi
process.on('SIGINT', () => {});

child.on('close', (kode) => {
  log.end(`# sesi ${sesi} selesai ${new Date().toISOString()} (exit ${kode ?? 'sinyal'})\n`, () => {
    process.exit(kode ?? 0);
  });
});
