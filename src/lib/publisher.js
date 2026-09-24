const amqp = require('amqplib');
const {
  RABBITMQ_URL,
  EXCHANGE,
  EXCHANGE_TYPE,
  QUEUE,
  ROUTING_KEY,
} = require('../config');

// Publish event satu per satu dan memastikan tiap pesan benar-benar masuk queue:
// - topology (exchange, queue, binding) dideklarasikan di sini juga, durable dan
//   sama dengan worker, sehingga pesan tidak hilang bila worker belum pernah jalan
// - publisher confirm: broker sudah menerima pesan
// - mandatory + event 'return': pesan yang tidak ter-route ke queue mana pun
//   dikembalikan broker dan dilaporkan sebagai error (confirm saja tidak cukup)
// Mengembalikan daftar event_id yang terkirim; melempar Error pada kegagalan pertama.
async function publishEvents(events, { routingKey = ROUTING_KEY, onPublished } = {}) {
  let conn, ch;
  try {
    conn = await amqp.connect(RABBITMQ_URL);
    ch   = await conn.createConfirmChannel();

    const dikembalikan = new Set();
    ch.on('return', (msg) => dikembalikan.add(msg.properties.messageId));

    await ch.assertExchange(EXCHANGE, EXCHANGE_TYPE, { durable: true });
    await ch.assertQueue(QUEUE, { durable: true });
    await ch.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);

    const terkirim = [];
    for (const event of events) {
      const sent = ch.publish(
        EXCHANGE,
        routingKey,
        Buffer.from(JSON.stringify(event)),
        {
          persistent:  true,
          mandatory:   true,
          contentType: 'application/json',
          messageId:   event.event_id,
        }
      );
      if (!sent) throw new Error(`Buffer penuh saat publish ${event.event_id}`);

      // basic.return dikirim broker sebelum ack, jadi sudah tercatat setelah confirm
      await ch.waitForConfirms();
      if (dikembalikan.has(event.event_id)) {
        throw new Error(
          `Pesan ${event.event_id} tidak ter-route ke queue mana pun `
          + `(exchange "${EXCHANGE}", routing key "${routingKey}")`
        );
      }

      terkirim.push(event.event_id);
      if (onPublished) onPublished(event);
    }
    return terkirim;
  } finally {
    if (ch)   await ch.close().catch(() => {});
    if (conn) await conn.close().catch(() => {});
  }
}

module.exports = { publishEvents };
