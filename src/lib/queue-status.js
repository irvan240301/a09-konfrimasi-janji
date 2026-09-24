const { RABBITMQ_URL, QUEUE } = require('../config');

// Kredensial Management API diturunkan dari RABBITMQ_URL — tidak hardcode ulang
const amqpUrl   = new URL(RABBITMQ_URL);
const MGMT_URL  = `http://${amqpUrl.hostname}:15672`;
const MGMT_AUTH = 'Basic ' + Buffer.from(
  `${decodeURIComponent(amqpUrl.username)}:${decodeURIComponent(amqpUrl.password)}`
).toString('base64');
const VHOST = encodeURIComponent(amqpUrl.pathname.slice(1) || '/');

async function getQueueStatus() {
  const response = await fetch(
    `${MGMT_URL}/api/queues/${VHOST}/${QUEUE}`,
    { headers: { Authorization: MGMT_AUTH } }
  );
  if (!response.ok) {
    throw new Error(`Management API status ${response.status}`);
  }
  const data = await response.json();
  return {
    ready:     data.messages_ready ?? 0,
    unacked:   data.messages_unacknowledged ?? 0,
    total:     data.messages ?? 0,
    consumers: data.consumers ?? 0,
  };
}

module.exports = { getQueueStatus };
