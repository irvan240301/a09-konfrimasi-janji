const path = require('path');
const { RUN_ID } = require('../config');
const { KATEGORI, buatEvents } = require('../lib/events');
const { publishEvents } = require('../lib/publisher');
const { saveInputIds } = require('../lib/evidence');

// Ambil argumen: kategori event yang mau dipublish
// Contoh: node src/producers/publish.js normal
//         node src/producers/publish.js gangguan
//         node src/producers/publish.js invalid
//         node src/producers/publish.js valid_setelah_invalid
const kategori = process.argv[2];
const events   = buatEvents(kategori, RUN_ID);

if (!events) {
  console.error(`Kategori tidak ditemukan. Pilihan: ${KATEGORI.join(' | ')}`);
  process.exit(1);
}

async function main() {
  try {
    await publishEvents(events, {
      onPublished: (event) => console.log(`✓ Published: ${event.event_id}`),
    });

    const file = saveInputIds({
      kategori,
      events,
      source:  'cli',
      command: `npm run publish ${kategori}`,
      runId:   RUN_ID,
    });

    console.log(`\nSelesai: ${events.length} event dipublish dari kategori "${kategori}"`);
    if (file) console.log(`Evidence input: ${path.relative(process.cwd(), file)}`);
  } catch (err) {
    console.error('Gagal:', err.message);
    process.exit(1);
  }
}

main();
