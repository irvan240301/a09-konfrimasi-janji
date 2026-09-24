# CLAUDE.md — Instruksi untuk Claude Code
# Proyek: A09 Konfirmasi Janji Layanan (Capstone MP-11 BPPK–Kemenkeu / ADINESIA 2026)

## KONTEKS PROYEK

Ini adalah proyek capstone peserta pelatihan Message Broker.
Peserta: irvan240301 | Kasus: A09 | Presentasi: 25 September 2026

Stack: Node.js 20.6+ · RabbitMQ 3.13 · PostgreSQL 16 · Docker

## STATUS SAAT INI

### Sudah selesai dan terbukti:
- [x] Infrastruktur: docker-compose.yml (RabbitMQ + PostgreSQL)
- [x] Schema DB: tabel `receipts` + `rejected` sudah dibuat
- [x] src/config.js — konstanta topology + koneksi pool
- [x] src/worker.js — consumer dengan idempotency + manual ack
- [x] src/publish.js — CLI publisher (AKAN DIGANTI server.js)
- [x] fixtures/events.json — data sintetis N01–N20, G01–G05, X01, V01
- [x] Bukti U1=20, U2=25, U3=25 (duplikat diabaikan), U4=26 receipt + X01 di rejected
- [x] README.md, .gitignore, .env.contoh

### Sedang dikerjakan (PRIORITAS MALAM INI):
- [ ] src/server.js — Express API Server (GANTI publish.js)
- [ ] public/index.html — Frontend satu halaman
- [ ] npm install express cors

### Belum dikerjakan (besok pagi sebelum presentasi):
- [ ] docs/diagram-a09.svg — diagram arsitektur
- [ ] docs/laporan.md — laporan 3-5 halaman
- [ ] Slide presentasi (5 slide)

---

## TOPOLOGY RABBITMQ

```
Exchange : appointments (direct, durable)
Queue    : confirmations (durable, persistent)
Routing  : appointment.booked
Alur     : Producer → appointments → confirmations → Worker → DB
```

## KONTRAK PESAN (WAJIB)

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

Field wajib U4: `appointment_id`. Tanpanya → tabel `rejected`.

## SKEMA DATABASE

```sql
-- Efek bisnis: satu receipt per event
CREATE TABLE IF NOT EXISTS receipts (
  event_id       TEXT PRIMARY KEY,  -- kunci idempotency
  appointment_id TEXT NOT NULL,
  customer_id    TEXT,
  slot           TEXT NOT NULL,     -- TEXT bukan TIMESTAMPTZ (simpan persis input)
  status         TEXT NOT NULL DEFAULT 'CONFIRMED_SIMULATION',
  run_id         TEXT NOT NULL,
  occurred_at    TIMESTAMPTZ,
  processed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Jalur terminal pesan tidak valid
CREATE TABLE IF NOT EXISTS rejected (
  id          BIGSERIAL PRIMARY KEY,
  event_id    TEXT,
  payload     JSONB,
  reason      TEXT NOT NULL,
  run_id      TEXT,
  rejected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## YANG HARUS DIBANGUN SEKARANG

### 1. src/server.js (Express API Server)

Endpoint yang dibutuhkan:

| Method | Path | Fungsi |
|--------|------|--------|
| POST | /api/publish/:kategori | Publish fixtures ke RabbitMQ |
| GET  | /api/receipts | Ambil semua receipt dari DB |
| GET  | /api/rejected | Ambil semua rejected dari DB |
| GET  | /api/queue-status | Cek status queue via RabbitMQ Management API |
| POST | /api/reset | TRUNCATE receipts + rejected |

Kategori publish: `normal` (N01–N20), `gangguan` (G01–G05),
`replay` (N01–N05), `invalid` (X01), `valid_setelah_invalid` (V01)

Data fixtures dibaca dari: `fixtures/events.json`
Publish menggunakan: `amqplib` (sama seperti publish.js yang lama)
Koneksi DB: pool dari config.js

### 2. public/index.html (Frontend satu halaman)

Empat bagian UI:

**Panel Kontrol U1–U4:**
- Tombol "Kirim N01–N20 (U1)" → POST /api/publish/normal
- Tombol "Kirim G01–G05 (U2)" → POST /api/publish/gangguan
- Tombol "Replay N01–N05 (U3)" → POST /api/publish/replay
- Tombol "Kirim X01 (U4)" → POST /api/publish/invalid
- Tombol "Kirim V01 (U4)" → POST /api/publish/valid_setelah_invalid
- Tombol "Reset DB" → POST /api/reset (merah, minta konfirmasi)

**Status Queue:**
- Tampilkan: Ready, Unacked, Total, Consumers
- Auto-refresh setiap 3 detik
- Indikator visual: hijau (normal), kuning (ada pesan menunggu)

**Tabel Receipts:**
- Kolom: event_id, appointment_id, slot, status, processed_at
- Auto-refresh setiap 3 detik
- Tampilkan total count di header

**Tabel Rejected:**
- Kolom: event_id, reason, rejected_at
- Auto-refresh setiap 3 detik

**Catatan desain frontend:**
- Pure HTML + CSS + JavaScript vanilla (TANPA React/Vue/framework)
- Tidak perlu build step
- Gaya modern: dark mode, warna konsisten dengan status
- Server berjalan di port 3000 → fetch ke http://localhost:3000/api/...

### 3. Perubahan package.json

```json
"scripts": {
  "start":    "node --env-file=.env src/server.js",
  "worker":   "node --env-file=.env src/worker.js",
  "db:reset": "docker exec -it a09-postgres psql -U a09user -d a09db -c \"TRUNCATE receipts, rejected RESTART IDENTITY;\""
}
```

### 4. Install dependency baru

```bash
npm install express cors
```

---

## ATURAN TETAP (JANGAN DILANGGAR)

### Idempotency
Worker menggunakan `ON CONFLICT (event_id) DO NOTHING`.
`ack` HANYA setelah receipt tersimpan di DB.
Jangan ubah logika ini di worker.js.

### Durability
Exchange + Queue harus `durable: true`.
Pesan publish harus `persistent: true`.
Jangan ubah ini.

### Validasi pesan
Pesan tanpa `appointment_id` → INSERT ke `rejected` → `ack` (tanpa requeue).
Error lingkungan (DB mati) → `nack(msg, false, true)` (requeue).
Bedakan dua jenis kegagalan ini.

### Data sintetis
Jangan ubah `event_id` di fixtures/events.json.
N01–N05 di kategori `replay` harus PERSIS sama dengan di `normal`.
Ini kunci keberhasilan U3.

### Kredensial
Semua nilai sensitif dari .env via `--env-file=.env`.
Jangan hardcode credentials di kode.
.env tidak boleh di-push ke GitHub.

### Queue status endpoint
RabbitMQ Management API ada di http://localhost:15672
Credentials: a09user / a09pass
Endpoint queue: GET http://localhost:15672/api/queues/a09vhost/confirmations

---

## CARA MENJALANKAN (SETELAH SERVER.JS SELESAI)

```bash
# Terminal 1 — Infrastruktur
docker compose up -d

# Terminal 2 — Worker
npm run worker

# Terminal 3 — API Server
npm run start

# Browser
buka http://localhost:3000
```

---

## TARGET ANGKA YANG SUDAH TERBUKTI (JANGAN DIUBAH)

| Uji | Aksi | Target | Terbukti |
|-----|------|--------|----------|
| U1 | Kirim N01–N20 | 20 receipt | ✅ 20 |
| U2 | Matikan worker + G01–G05 | 25 receipt | ✅ 25 |
| U3 | Replay N01–N05 | Tetap 25 | ✅ 25 |
| U4 | X01 + V01 | 26 receipt, X01 di rejected | ✅ 26 |

---

## CATATAN UNTUK CLAUDE CODE

1. Peserta adalah software engineer pemula — jelaskan setiap keputusan teknis.
2. Jangan sarankan deployment produksi, Kubernetes, cluster HA, atau dua broker.
3. Kalau ada yang ambigu, tanya 1 pertanyaan singkat dulu.
4. Setiap perubahan kode → ingatkan untuk `git add . && git commit && git push`.
5. Prioritas malam ini: server.js + index.html. Laporan besok pagi.
6. Catat penggunaan AI di README (sudah ada catatannya).
7. Worker.js TIDAK BOLEH diubah — logika idempotency sudah terbukti benar.
