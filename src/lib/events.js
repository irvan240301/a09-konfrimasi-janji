// Generator data uji sintetis A09. Deterministik: ID dan payload dihitung dari
// nomor urut (tanpa acak), sehingga memanggil ulang dengan runId yang sama
// menghasilkan event yang persis sama — syarat replay U3.

const HARI_SLOT_AWAL = Date.UTC(2026, 8, 28);
const JAM_SLOT       = [9, 10, 11, 13, 14, 15];

const pad = (n, lebar = 2) => String(n).padStart(lebar, '0');

// Slot ke-seq: enam slot per hari, dimulai 2026-09-28 pukul 09:00 (WIB)
function slotKe(seq) {
  const d = new Date(HARI_SLOT_AWAL + Math.floor(seq / JAM_SLOT.length) * 86400000);
  const tanggal = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return `${tanggal}T${pad(JAM_SLOT[seq % JAM_SLOT.length])}:00:00+07:00`;
}

function waktu(jam, menit) {
  return new Date(Date.UTC(2026, 8, 23, jam, menit)).toISOString().replace('.000Z', 'Z');
}

function event(runId, kode, occurredAt, payload) {
  return {
    event_id:    `${runId}-${kode}`,
    event_type:  'appointment.booked',
    occurred_at: occurredAt,
    payload,
  };
}

function booking(runId, kode, seq, nomorApt, occurredAt) {
  return event(runId, kode, occurredAt, {
    appointment_id: `APT-${pad(nomorApt, 3)}`,
    customer_id:    `CUS-${pad(nomorApt, 3)}`,
    slot:           slotKe(seq),
  });
}

const normal = (runId) =>
  Array.from({ length: 20 }, (_, i) => booking(runId, `N${pad(i + 1)}`, i, i + 1, waktu(1, i)));

const gangguan = (runId) =>
  Array.from({ length: 5 }, (_, i) => booking(runId, `G${pad(i + 1)}`, 20 + i, 21 + i, waktu(2, i)));

const GENERATOR = {
  normal,
  gangguan,
  // U3: N01–N05 dihasilkan dari generator yang sama dengan normal, jadi pasti identik
  replay: (runId) => normal(runId).slice(0, 5),
  // U4: X01 sengaja tanpa appointment_id
  invalid: (runId) => [
    event(runId, 'X01', waktu(3, 0), { customer_id: 'CUS-099', slot: slotKe(25) }),
  ],
  valid_setelah_invalid: (runId) => [booking(runId, 'V01', 26, 26, waktu(3, 1))],
};

const KATEGORI = Object.keys(GENERATOR);

// Mengembalikan array event, atau undefined bila kategori tidak dikenal
function buatEvents(kategori, runId) {
  return Object.hasOwn(GENERATOR, kategori) ? GENERATOR[kategori](runId) : undefined;
}

module.exports = { KATEGORI, buatEvents };
