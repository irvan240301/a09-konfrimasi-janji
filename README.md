# A09 — Konfirmasi Janji Layanan

## Identitas

| Field | Detail |
|-------|--------|
| Nama | irvan240301 |
| Kode Kasus | A09 |
| Pola | Worker (W) — satu queue, satu consumer |
| Stack | Node.js 20.6+ · RabbitMQ 3.13 · PostgreSQL 16 |
| Tanggal Uji | 2026-09-24 |

## Anggota dan Kontribusi

Pengerjaan individu oleh **irvan240301**: pemilihan kasus, desain topology dan
kontrak pesan, implementasi producer/consumer/dashboard, pengujian U1–U4,
pengumpulan evidence, dan dokumentasi. Bantuan alat AI dijelaskan pada bagian
[Penggunaan Alat AI dan Referensi](#penggunaan-alat-ai-dan-referensi).

## Deskripsi Singkat

Layanan reservasi fiktif menerima pemesanan janji konsultasi.
Konfirmasi dikerjakan worker secara asinkron dan disimpan sebagai
receipt simulasi (`CONFIRMED_SIMULATION`) di PostgreSQL.
Gangguan worker tidak membuat pemesanan harus diulang karena
pesan tertahan di queue hingga worker pulih.

## Topology

```
Producer → exchange "appointments" (direct)
         → routing key "appointment.booked"
         → queue "confirmations"
         → Worker → tabel receipts (PostgreSQL)

Pesan tidak valid → tabel rejected (PostgreSQL)
```

Exchange dan queue `durable`, pesan `persistent`. Worker mengambil satu pesan per
giliran (`prefetch 1`), melakukan ack **hanya setelah** receipt tersimpan, dan
memakai `event_id` sebagai primary key sehingga pengiriman ulang tidak menggandakan
receipt (`INSERT ... ON CONFLICT (event_id) DO NOTHING`). Pesan tanpa
`appointment_id` masuk tabel `rejected` lalu di-ack (tanpa requeue); error
lingkungan (misalnya database mati) di-`nack` dengan requeue.

### Penanganan hasil publish

Publisher confirm hanya membuktikan broker menerima pesan, bukan bahwa pesan
masuk queue tujuan. `src/lib/publisher.js` (dipakai dashboard dan CLI) karena itu:

- mendeklarasikan exchange, queue `confirmations`, dan binding (durable, sama dengan
  worker), sehingga pesan tertahan di queue walau worker belum pernah dijalankan;
- memakai publisher confirm **dan** flag `mandatory`: pesan yang tidak ter-route ke
  queue mana pun dikembalikan broker (`basic.return`) dan dilaporkan sebagai error
  (`Pesan ... tidak ter-route ke queue mana pun`), bukan dianggap sukses;
- mengirim tiap pesan `persistent` dengan `messageId` = `event_id`.

## Kontrak Pesan

```json
{
  "event_id":    "run01-N01",
  "event_type":  "appointment.booked",
  "occurred_at": "2026-09-23T01:00:00Z",
  "payload": {
    "appointment_id": "APT-001",
    "customer_id":    "CUS-001",
    "slot":           "2026-09-28T09:00:00+07:00"
  }
}
```

Field wajib untuk U4: `appointment_id`. Pesan tanpa field ini
ditolak ke tabel `rejected` tanpa efek bisnis. `slot` disimpan sebagai teks
persis seperti input (tanpa mesin penjadwalan).

## Data Uji

Data uji sintetis dibangkitkan oleh `src/lib/events.js` — deterministik
(tanpa acak): `event_id`, `appointment_id`, dan `slot` dihitung dari nomor urut,
jadi replay U3 selalu menghasilkan event yang persis sama dengan N01–N05 asli.
Prefiks `event_id` diambil dari `RUN_ID` di `.env` (default `run01`); ganti
(misalnya `run02`) untuk pengujian baru agar bukti tidak bercampur.

| Kategori | Event | Untuk |
|----------|-------|-------|
| `normal` | N01–N20 | U1 |
| `gangguan` | G01–G05 | U2 |
| `replay` | N01–N05 (identik dengan `normal`) | U3 |
| `invalid` | X01 (tanpa `appointment_id`) | U4 |
| `valid_setelah_invalid` | V01 | U4 |

## Struktur Proyek

```
src/
  config/index.js         konstanta topology + koneksi PostgreSQL
  consumers/worker.js     consumer (worker)
  producers/publish.js    CLI: publish satu kategori event uji
  producers/producer.js   CLI: publish satu event dari argumen JSON
  api/server.js           API + dashboard (port 3000)
  lib/events.js           generator data uji sintetis
  lib/publisher.js        publish dengan confirm + mandatory/return
  lib/perekam.js          perekam evidence otomatis (dipicu server)
  lib/snapshot.js         snapshot DB + queue + perbandingan ID
  lib/evidence.js         penulis berkas evidence
  lib/queue-status.js     status queue via RabbitMQ Management API
  tools/hasil.js          CLI: rekam snapshot manual
  tools/worker-log.js     CLI: jalankan worker + salin log ke evidence/
public/index.html         dashboard satu halaman
db/schema.sql             skema tabel receipts dan rejected
docker-compose.yml        RabbitMQ + PostgreSQL
evidence/                 bukti pengujian per uji
```

## Prasyarat

- Docker Desktop (running)
- Node.js 20.6 atau lebih baru
- Repository ini

Cek versi:

```bash
node -v       # harus >= 20.6
docker -v
```

## Setup

```bash
# 1. Salin konfigurasi (nilai contoh sudah cocok dengan docker-compose.yml)
cp .env.contoh .env

# 2. Jalankan infrastruktur
docker compose up -d

# 3. Install dependencies
npm install
```

Buat skema database:

```powershell
# PowerShell
Get-Content db/schema.sql | docker exec -i a09-postgres psql -U a09user -d a09db
```

```bash
# bash / Git Bash / Linux / macOS
docker exec -i a09-postgres psql -U a09user -d a09db < db/schema.sql
```

```bash
# Verifikasi tabel berhasil dibuat — harus muncul: receipts dan rejected
docker exec -it a09-postgres psql -U a09user -d a09db -c "\dt"
```

`.env` berisi kredensial lab sintetis yang sama dengan `docker-compose.yml`
(`a09user` / `a09pass`, vhost `a09vhost`, database `a09db`). Jika salah satu diubah
di `docker-compose.yml`, ubah juga di `.env`. File `.env` tidak ikut git.

## Start

Buka dua terminal terpisah:

```bash
# Terminal 1 — worker (saat merekam evidence pakai worker:log; lihat "Merekam Evidence")
npm run worker

# Tunggu hingga muncul:
# Worker siap. Exchange: appointments | Queue: confirmations | Run: run01
```

```bash
# Terminal 2 — API server + dashboard
npm run start

# Tunggu hingga muncul:
# Server siap di http://localhost:3000
```

Buka `http://localhost:3000` untuk dashboard.

## Publish & Test (U1–U4)

Publish dilakukan lewat dashboard (atau CLI, lihat bawah). Klik **Reset DB**
lebih dulu untuk memulai dari kondisi bersih — tanpa itu, event dengan `event_id`
yang sama hanya tercatat sebagai duplikat (perilaku idempotency yang memang
diharapkan), bukan gagal. Tunggu snapshot tiap tahap muncul di panel
**Evidence Otomatis** sebelum klik tombol berikutnya.

```
U1 — 20 event valid (N01–N20)
  Klik "Kirim N01–N20 (U1)"
  → Receipts di dashboard menjadi 20

U2 — Gangguan consumer
  1. Tekan CTRL+C di Terminal 1 (matikan worker)
  2. Klik "Kirim G01–G05 (U2)"
  3. Status Queue: Ready naik menjadi 5, Consumers 0
     (atau Management UI: http://localhost:15672 → queue confirmations)
  4. Hidupkan lagi worker di Terminal 1
  5. Worker memproses G01–G05 sendiri tanpa kirim ulang manual
     → Ready kembali 0, Receipts menjadi 25

U3 — Replay idempotency (N01–N05 dengan event_id dan payload semula)
  Klik "Replay N01–N05 (U3)"
  → Receipts tetap 25, log worker menampilkan "Duplikat diabaikan"

U4 — Pesan tidak valid + valid setelahnya
  Klik "Kirim X01 (U4)" → Rejected menjadi 1 (MISSING_appointment_id), Receipts tetap 25
  Klik "Kirim V01 (U4)" → Receipts menjadi 26
```

Batas waktu tunggu yang dipakai: 60 detik per tahap (untuk pemulihan worker di U2
sampai 15 menit). Panel Status Queue dan tabel Receipts/Rejected auto-refresh
setiap 3 detik.

### Alternatif: CLI (tanpa dashboard)

```bash
npm run publish normal
npm run publish gangguan
npm run publish replay
npm run publish invalid
npm run publish valid_setelah_invalid
```

CLI memakai publisher yang sama (deteksi pesan tak ter-route ikut berlaku).
Snapshot hasil tidak otomatis lewat CLI; rekam dengan `npm run hasil` (di bawah).

## Merekam Evidence

Folder `evidence/` dikelompokkan per uji:

| File | Dibuat oleh | Isi |
|------|-------------|-----|
| `evidence/<uji>/input-<kategori>.json` | setiap publish (dashboard maupun CLI) | daftar `event_id` dan isi event yang dikirim, perintah, waktu |
| `evidence/<uji>/hasil[-<tahap>].json` | otomatis oleh server setelah kirim dari dashboard, atau manual `npm run hasil` | isi tabel receipts/rejected, status queue (ready/unacked/consumers), perbandingan ID diharapkan vs aktual |
| `evidence/worker-sesi1.log`, `worker-sesi2.log` | `npm run worker:log -- <sesi>` | log worker (UTF-8) dengan waktu mulai/selesai |

Untuk merekam log worker, jalankan worker dengan `npm run worker:log -- sesi1`
(menggantikan `npm run worker`): sesi 1 sampai worker dimatikan di U2, lalu
`npm run worker:log -- sesi2` setelah dihidupkan lagi. Outputnya tetap tampil di
terminal dan disalin ke `evidence/worker-<sesi>.log`. Jangan memakai pipa
`| Tee-Object`: di terminal Windows ber-code page 437 tanda ✓ menjadi `Γ£ô`.

### Otomatis (dashboard)

Tidak ada tombol rekam. Server memantau queue setelah tiap kirim dan menyimpan
snapshot pada saat yang tepat:

| Kirim dari dashboard | Snapshot yang tersimpan otomatis |
|----------------------|----------------------------------|
| N01–N20 (U1) | `U1/hasil.json` setelah queue kosong (Ready=0, Unacked=0) |
| G01–G05 (U2) | `U2/hasil-sebelum-gangguan.json` (sebelum G01–G05 dikirim), `U2/hasil-saat-tertahan.json` (Ready>0, Consumers=0), `U2/hasil-sesudah-pemulihan.json` (worker hidup lagi dan queue kosong) |
| Replay N01–N05 (U3) | `U3/hasil.json` |
| X01 (U4) | `U4/hasil-setelah-x01.json` |
| V01 (U4) | `U4/hasil.json` |

- Statistik queue RabbitMQ diperbarui tiap ±5 detik, jadi snapshot muncul
  sekitar 6–10 detik setelah kirim.
- Bila batas tunggu terlampaui, kondisi terakhir tetap direkam dan ditandai merah.
- Untuk U2, matikan worker **sebelum** klik "Kirim G01–G05", dan hidupkan lagi
  setelah snapshot `saat-tertahan` muncul di panel.
- Publish ulang kategori yang sama menimpa `input-<kategori>.json` sebelumnya,
  jadi rekam dari satu rangkaian uji yang bersih (Reset DB dulu).

### Manual (CLI)

`npm run hasil -- <uji> [tahap]` menghasilkan berkas yang sama dan hanya membaca
database. Exit code 1 bila himpunan ID tidak sesuai target.

```bash
npm run hasil -- U1
npm run hasil -- U2 sebelum-gangguan     # worker hidup, sebelum G01–G05
npm run hasil -- U2 saat-tertahan        # harus ready=5, consumers=0
npm run hasil -- U2 sesudah-pemulihan    # 25 receipt
npm run hasil -- U3
npm run hasil -- U4 setelah-x01          # rejected=1, receipts 25
npm run hasil -- U4                      # receipts 26
```

## Cara Memeriksa Hasil

Cara tercepat: tabel **Receipts** dan **Rejected** di dashboard, atau API-nya:

```bash
curl http://localhost:3000/api/receipts
curl http://localhost:3000/api/rejected
curl http://localhost:3000/api/queue-status
```

Atau lewat DBeaver/psql, koneksi ke `a09db`:

```sql
-- Hitung receipt (target akhir U4: 26)
SELECT count(*) FROM receipts;

-- Lihat semua receipt
SELECT event_id, appointment_id, slot, status, processed_at
FROM receipts
ORDER BY event_id;

-- Lihat pesan ditolak (X01 harus ada)
SELECT event_id, reason, rejected_at
FROM rejected;
```

### Target dan hasil pengamatan

Hasil pengamatan di bawah diambil dari berkas di `evidence/` (run 2026-09-24,
prefiks `run01`); perbandingan himpunan ID input vs output SESUAI pada semua tahap.

| Uji | Target | Hasil pengamatan | Bukti |
|-----|--------|------------------|-------|
| U1 | 20 receipt | 20 receipt; Ready=0, Unacked=0, Consumers=1 | `U1/input-normal.json`, `U1/hasil.json`, `worker-sesi1.log` (20× "Receipt tersimpan") |
| U2 | 5 pesan tertahan, lalu 25 receipt tanpa kirim ulang | sebelum gangguan 20; saat tertahan **Ready=5**, Unacked=0, Consumers=0, receipt tetap 20; sesudah pemulihan 25, Ready=0 | `U2/hasil-sebelum-gangguan.json`, `U2/hasil-saat-tertahan.json`, `U2/hasil-sesudah-pemulihan.json`, `U2/input-gangguan.json` |
| U3 | tetap 25, tanpa efek ganda | 25 receipt; 5× "Duplikat diabaikan" di log worker | `U3/input-replay.json`, `U3/hasil.json`, `worker-sesi2.log` |
| U4 | X01 ditolak tanpa efek bisnis, V01 selesai → 26 | setelah X01: rejected=1 (`MISSING_appointment_id`), receipt 25; setelah V01: receipt **26** | `U4/hasil-setelah-x01.json`, `U4/hasil.json`, `U4/input-*.json` |

Setiap tahap tercapai dalam kurang dari 10 detik, jauh di bawah batas tunggu 60
detik.

## Stop

```bash
# Stop worker: tekan CTRL+C di Terminal 1
# Stop API server: tekan CTRL+C di Terminal 2

# Stop container — data TETAP ada (volume tidak dihapus)
docker compose stop

# Stop dan HAPUS semua data (hanya jika ingin mulai bersih)
docker compose down -v
```

> **Catatan:** `docker compose stop` menjaga volume sehingga
> data receipt dan queue bertahan ke sesi berikutnya.
> `docker compose down -v` menghapus volume — jalankan hanya
> jika ingin reset total.

## Batas Prototipe

- Delivery broker = at-least-once, bukan exactly-once; hasil uji ini tidak
  menjamin tanpa kehilangan pesan secara menyeluruh.
- Ada celah antara request diterima dan event dipublish (tanpa outbox pattern);
  jika publish gagal di tengah rangkaian, sebagian pesan bisa sudah masuk queue.
- Idempotency dijamin untuk `event_id` stabil — tidak mencakup crash di tengah
  transaksi DB.
- Uji terbatas pada gangguan consumer, bukan kegagalan seluruh infrastruktur.
  U3 membuktikan duplikasi lewat pengiriman ulang event yang sama; redelivery
  langsung oleh broker (mis. worker mati sebelum ack) tidak diuji terpisah.
- Hanya `appointment_id` yang divalidasi (sesuai kontrak U4). Pesan yang punya
  `appointment_id` tetapi tanpa `slot` atau `event_id` melanggar constraint
  database dan diperlakukan sebagai error lingkungan (requeue tanpa batas), dan body
  JSON `null` menghentikan worker. Penolakan pesan cacat di luar `appointment_id`
  belum ditangani.
- Dashboard tidak memiliki autentikasi, dan port aplikasi serta Docker terbuka di
  semua antarmuka jaringan dengan kredensial lab bawaan. Gunakan hanya di jaringan
  lokal yang terisolasi dan ganti kredensial sebelum dipakai di luar lab.
- Satu node broker tanpa TLS; status queue dibaca lewat Management API (HTTP).

## Penggunaan Alat AI dan Referensi

**Alat AI.** Claude Code (Anthropic, model Claude Sonnet 5) dipakai pada sesi
pengembangan untuk: dashboard dan API server (`src/api/server.js`,
`public/index.html`), generator data uji (`src/lib/events.js`), publisher dengan
deteksi pesan tak ter-route (`src/lib/publisher.js`), perekam dan perkakas evidence
(`perekam.js`, `snapshot.js`, `evidence.js`, `hasil.js`, `worker-log.js`),
penataan ulang folder `src/`, tinjauan keamanan dan kode tak terpakai, serta
penulisan dokumentasi ini. Instruksi kerja untuk AI disimpan di `CLAUDE.md`.

- Logika `src/consumers/worker.js` (idempotency, ack setelah efek tersimpan,
  pemisahan penolakan vs error lingkungan) **tidak diubah** oleh AI; berkas itu
  hanya dipindahkan ke `src/consumers/` dengan penyesuaian path import.
- Rangkaian bukti final di `evidence/` dijalankan oleh Claude Code di mesin
  peserta lewat endpoint API dashboard (jalur kode yang sama dengan tombolnya),
  dengan worker berjalan lewat `npm run worker:log`, terhadap RabbitMQ dan
  PostgreSQL lokal.
- Peserta bertanggung jawab memahami dan membuktikan hasilnya.

**Referensi.**

- Panduan *Capstone Project — Implementasi dan Pengelolaan Message Broker untuk
  Arsitektur Microservices* (BPPK–Kemenkeu / ADINESIA, v1.0): kasus A09,
  ketentuan implementasi, skenario U1–U4, dan daftar berkas pengumpulan.
- Materi dan starter SIMPEL (`chmdznr/simpel-lab`): rujukan pola work queue
  dengan manual ack, receipt/idempotency, dan pola pengumpulan bukti (skrip kirim
  dan hasil, folder evidence).
