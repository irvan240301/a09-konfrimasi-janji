# A09 — Konfirmasi Janji Layanan

## Identitas

| Field | Detail |
|-------|--------|
| Nama | irvan240301 |
| Kode Kasus | A09 |
| Pola | Worker (W) — satu queue, satu consumer |
| Stack | Node.js 20.6+ · RabbitMQ 3.13 · PostgreSQL 16 |
| Tanggal Uji | 2026-09-23 |

## Deskripsi Singkat

Layanan reservasi fiktif menerima pemesanan janji konsultasi.
Konfirmasi dikerjakan worker secara asinkron dan disimpan sebagai
receipt simulasi (CONFIRMED_SIMULATION) di PostgreSQL.
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
ditolak ke tabel `rejected` tanpa efek bisnis.

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
# 1. Salin konfigurasi
cp .env.contoh .env
# Edit .env sesuai kebutuhan (nilai default sudah cocok dengan docker-compose.yml)

# 2. Jalankan infrastruktur
docker compose up -d

# 3. Install dependencies
npm install

# 4. Buat skema database (PowerShell)
Get-Content db/schema.sql | docker exec -i a09-postgres psql -U a09user -d a09db

# Verifikasi tabel berhasil dibuat
docker exec -it a09-postgres psql -U a09user -d a09db -c "\dt"
# Harus muncul: receipts dan rejected
```

## Start

Buka dua terminal terpisah:

```bash
# Terminal 1 — jalankan worker
npm run worker

# Tunggu hingga muncul:
# Worker siap. Exchange: appointments | Queue: confirmations | Run: run01
```

```bash
# Terminal 2 — jalankan API server + dashboard
npm run start

# Tunggu hingga muncul:
# Server siap di http://localhost:3000
```

Buka browser ke `http://localhost:3000` untuk dashboard kontrol.

## Publish & Test (U1–U4)

Semua publish sekarang dilakukan lewat dashboard (`http://localhost:3000`).
Kalau ingin reset bukti dari nol, klik tombol merah **"Reset DB"** dulu
(TRUNCATE `receipts` + `rejected`) — kalau tidak, event dengan `event_id`
yang sama hanya akan tercatat sebagai duplikat (perilaku idempotency
yang memang diharapkan), bukan gagal.

```
U1 — 20 event valid (N01–N20)
  Klik "Kirim N01–N20 (U1)"
  → Tabel Receipts di dashboard harus jadi 20

U2 — Gangguan consumer
  1. Tekan CTRL+C di Terminal 1 (matikan worker)
  2. Klik "Kirim G01–G05 (U2)" di dashboard
  3. Lihat panel Status Queue di dashboard → Ready harus naik jadi 5
     (atau cek Management UI: http://localhost:15672 → queue confirmations)
  4. Hidupkan kembali worker: npm run worker di Terminal 1
  5. Worker memproses G01–G05 otomatis tanpa kirim ulang manual
     → Status Queue kembali ke 0, Receipts naik jadi 25

U3 — Replay idempotency (N01–N05 dengan event_id dan payload semula)
  Klik "Replay N01–N05 (U3)"
  → Receipts tetap 25, log worker menampilkan "Duplikat diabaikan"

U4 — Pesan tidak valid + valid setelahnya
  Klik "Kirim X01 (U4)" → Rejected bertambah 1 (MISSING_appointment_id), Receipts tetap 25
  Klik "Kirim V01 (U4)" → Receipts naik jadi 26
```

Panel Status Queue dan tabel Receipts/Rejected di dashboard auto-refresh
setiap 3 detik, jadi tidak perlu refresh manual saat menguji.

### Alternatif: CLI (tanpa dashboard)

Script `npm run publish` (via `src/producers/publish.js`) masih tersedia sebagai
fallback kalau dashboard tidak dipakai:

```bash
npm run publish normal
npm run publish gangguan
npm run publish replay
npm run publish invalid
npm run publish valid_setelah_invalid
```

## Merekam Evidence

Folder `evidence/` diisi otomatis, dikelompokkan per uji:

| File | Dibuat oleh | Isi |
|------|-------------|-----|
| `evidence/<uji>/input-<kategori>.json` | setiap publish (dashboard maupun CLI) | daftar `event_id` yang dikirim, perintah, waktu |
| `evidence/<uji>/hasil[-<tahap>].json` | tombol **Rekam** di dashboard **atau** `npm run hasil -- <uji> [tahap]` (hasilnya identik) | isi tabel receipts/rejected, status queue (ready/unacked/consumers), perbandingan ID diharapkan vs aktual |
| `evidence/worker.log` | `npm run worker` dengan `Tee-Object` | log worker |

Ada dua cara merekam hasil, pilih salah satu atau campur:

- **Dashboard**: setelah uji selesai, klik tombol di panel **Rekam Evidence**
  (U1, U2 tiga tahap, U3, U4). Ringkasan hasil dan path file tampil di bawah tombol.
- **CLI**: jalankan `npm run hasil -- <uji> [tahap]`, urutannya di bawah.

Urutan perekaman dengan CLI (jalankan `hasil` setelah tiap uji selesai):

```powershell
# Terminal 1 — worker, log tampil sekaligus tersimpan
npm run worker | Tee-Object -FilePath evidence/worker.log

# U1: klik "Kirim N01–N20", lalu
npm run hasil -- U1

# U2: rekam tiga tahap
npm run hasil -- U2 sebelum-gangguan     # worker masih hidup, sebelum G01–G05
# matikan worker, klik "Kirim G01–G05"
npm run hasil -- U2 saat-tertahan        # harus terlihat ready=5, consumers=0
# hidupkan worker lagi
npm run hasil -- U2 sesudah-pemulihan    # 25 receipt

# U3: klik "Replay N01–N05", lalu
npm run hasil -- U3

# U4: klik "Kirim X01" dan "Kirim V01", lalu
npm run hasil -- U4
```

`hasil` selesai dengan exit code 1 bila himpunan ID tidak sesuai target, dan
hanya membaca database (tidak mengubah data). Publish ulang kategori yang sama
menimpa `input-<kategori>.json` sebelumnya, jadi rekam evidence dari satu
rangkaian uji yang bersih (klik "Reset DB" dulu).

## Cara Memeriksa Hasil

Cara tercepat: lihat langsung tabel **Receipts** dan **Rejected** di
dashboard (`http://localhost:3000`), atau panggil API-nya:

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

Target angka yang dibuktikan:

| Uji | Aksi (dashboard) | Target | Hasil Aktual |
|-----|-------------------|--------|--------------|
| U1 | "Kirim N01–N20 (U1)" | count = 20 | 20 ✅ |
| U2 | "Kirim G01–G05 (U2)" + restart worker | count = 25, Ready=5 terbukti | 25 ✅ |
| U3 | "Replay N01–N05 (U3)" | count tetap 25, log "Duplikat diabaikan" | 25 ✅ |
| U4 | "Kirim X01 (U4)" + "Kirim V01 (U4)" | count = 26, X01 di rejected | 26 ✅ |

## Stop

```bash
# Stop worker
# Tekan CTRL+C di Terminal 1

# Stop API server
# Tekan CTRL+C di Terminal 2

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

- Delivery broker = at-least-once, bukan exactly-once
- Ada celah antara request diterima dan event dipublish (tanpa outbox pattern)
- Idempotency dijamin untuk event_id stabil — tidak mencakup crash di tengah transaksi DB
- Uji terbatas pada gangguan consumer, bukan kegagalan seluruh infrastruktur
