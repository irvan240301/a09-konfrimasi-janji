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

## Publish & Test (U1–U4)

Jalankan dari Terminal 2 setelah worker siap:

```bash
# U1 — 20 event valid (N01–N20)
npm run publish normal

# U2 — Gangguan consumer
# 1. Tekan CTRL+C di Terminal 1 (matikan worker)
# 2. Publish G01–G05:
npm run publish gangguan
# 3. Cek Management UI: http://localhost:15672 → queue confirmations → Ready=5
# 4. Hidupkan kembali worker di Terminal 1:
npm run worker
# 5. Worker memproses G01–G05 otomatis tanpa kirim ulang manual

# U3 — Replay idempotency (N01–N05 dengan event_id dan payload semula)
npm run publish replay

# U4 — Pesan tidak valid + valid setelahnya
npm run publish invalid
npm run publish valid_setelah_invalid
```

## Cara Memeriksa Hasil

Buka DBeaver atau psql, koneksi ke `a09db`:

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

| Uji | Perintah | Target | Hasil Aktual |
|-----|----------|--------|--------------|
| U1 | publish normal | count = 20 | 20 ✅ |
| U2 | publish gangguan + restart worker | count = 25, Ready=5 terbukti | 25 ✅ |
| U3 | publish replay | count tetap 25, log "Duplikat diabaikan" | 25 ✅ |
| U4 | publish invalid + valid_setelah_invalid | count = 26, X01 di rejected | 26 ✅ |

## Stop

```bash
# Stop worker
# Tekan CTRL+C di Terminal 1

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
