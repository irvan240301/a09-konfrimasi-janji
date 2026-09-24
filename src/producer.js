const amqp = require('amqplib');
const {
  RABBITMQ_URL,
  EXCHANGE,
  ROUTING_KEY,
  EXCHANGE_TYPE,
} = require('./config');

// Ambil data event dari argumen CLI
// Contoh pemakaian: node src/producer.js '{"event_id":"run01-N01",...}'
async function publish(eventJson) {
  let conn, ch;
  try {
    // Parse dan validasi input
    const event = JSON.parse(eventJson);
    if (!event.event_id)   throw new Error('event_id wajib ada');
    if (!event.event_type) throw new Error('event_type wajib ada');
    if (!event.occurred_at) throw new Error('occurred_at wajib ada');
    if (!event.payload)    throw new Error('payload wajib ada');

    // Koneksi ke broker
    conn = await amqp.connect(RABBITMQ_URL);
    ch   = await conn.createConfirmChannel();

    // Deklarasi exchange — durable agar tahan restart
    await ch.assertExchange(EXCHANGE, EXCHANGE_TYPE, { durable: true });

    // Publish dengan persistent: true — pesan tidak hilang saat broker restart
    const sent = ch.publish(
      EXCHANGE,
      ROUTING_KEY,
      Buffer.from(JSON.stringify(event)),
      { persistent: true, contentType: 'application/json' }
    );

    if (!sent) throw new Error('Buffer penuh, pesan tidak terkirim');

    // Publisher confirm — tunggu broker konfirmasi pesan diterima
    await ch.waitForConfirms();

    console.log(`✓ Published: ${event.event_id} | type: ${event.event_type}`);
  } catch (err) {
    console.error(`✗ Gagal publish:`, err.message);
    process.exit(1);
  } finally {
    if (ch)   await ch.close().catch(() => {});
    if (conn) await conn.close().catch(() => {});
  }
}

// Ambil argumen dari CLI
const input = process.argv[2];
if (!input) {
  console.error('Penggunaan: node src/producer.js \'<json_event>\'');
  process.exit(1);
}

publish(input);