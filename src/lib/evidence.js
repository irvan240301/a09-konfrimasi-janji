const fs   = require('fs');
const path = require('path');

const EVIDENCE_DIR = path.join(__dirname, '../../evidence');

// Kategori event uji -> label uji pada folder evidence/
const UJI_BY_KATEGORI = {
  normal:                'U1',
  gangguan:              'U2',
  replay:                'U3',
  invalid:               'U4',
  valid_setelah_invalid: 'U4',
};

function writeEvidence(uji, filename, data) {
  const dir = path.join(EVIDENCE_DIR, uji);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, filename);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return file;
}

// Catat event yang dikirim (daftar ID + isi lengkap). Kegagalan tulis tidak boleh
// menggagalkan publish yang sudah berhasil, jadi hanya diberi peringatan.
function saveInputIds({ kategori, events, source, command, runId }) {
  const uji = UJI_BY_KATEGORI[kategori];
  if (!uji) return null;
  try {
    return writeEvidence(uji, `input-${kategori}.json`, {
      uji,
      kategori,
      run_id:       runId,
      source,
      command,
      published_at: new Date().toISOString(),
      count:        events.length,
      event_ids:    events.map((e) => e.event_id),
      events,
    });
  } catch (err) {
    console.error(`! Gagal menulis evidence: ${err.message}`);
    return null;
  }
}

module.exports = { EVIDENCE_DIR, UJI_BY_KATEGORI, writeEvidence, saveInputIds };
