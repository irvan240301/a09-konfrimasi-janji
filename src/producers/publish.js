const amqp = require('amqplib');
const path = require('path');
const {
  RABBITMQ_URL,
  EXCHANGE,
  ROUTING_KEY,
  EXCHANGE_TYPE,
  RUN_ID,
} = require('../config');
const { KATEGORI, buatEvents } = require('../lib/events');
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

async function publishAll(events) {
  let conn, ch;
  try {
    conn = await amqp.connect(RABBITMQ_URL);
    ch   = await conn.createConfirmChannel();

    await ch.assertExchange(EXCHANGE, EXCHANGE_TYPE, { durable: true });

    for (const event of events) {
      const sent = ch.publish(
        EXCHANGE,
        ROUTING_KEY,
        Buffer.from(JSON.stringify(event)),
        { persistent: true, contentType: 'application/json' }
      );
      if (!sent) throw new Error(`Buffer penuh saat publish ${event.event_id}`);
      await ch.waitForConfirms();
      console.log(`✓ Published: ${event.event_id}`);
    }

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
  } finally {
    if (ch)   await ch.close().catch(() => {});
    if (conn) await conn.close().catch(() => {});
  }
}

publishAll(events);
