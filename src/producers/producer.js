const { publishEvents } = require('../lib/publisher');

// Ambil data event dari argumen CLI
// Contoh pemakaian: node --env-file=.env src/producers/producer.js '{"event_id":"run01-N01",...}'
async function publish(eventJson) {
  try {
    // Parse dan validasi input
    const event = JSON.parse(eventJson);
    if (!event.event_id)    throw new Error('event_id wajib ada');
    if (!event.event_type)  throw new Error('event_type wajib ada');
    if (!event.occurred_at) throw new Error('occurred_at wajib ada');
    if (!event.payload)     throw new Error('payload wajib ada');

    await publishEvents([event]);
    console.log(`✓ Published: ${event.event_id} | type: ${event.event_type}`);
  } catch (err) {
    console.error(`✗ Gagal publish:`, err.message);
    process.exit(1);
  }
}

// Ambil argumen dari CLI
const input = process.argv[2];
if (!input) {
  console.error('Penggunaan: node --env-file=.env src/producers/producer.js \'<json_event>\'');
  process.exit(1);
}

publish(input);
