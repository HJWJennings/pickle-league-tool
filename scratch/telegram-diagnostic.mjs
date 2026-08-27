/**
 * THROWAWAY. Sends one real, clearly-labeled test message using the exact
 * same method as index.js's sendToTelegram: raw fetch, no parse_mode,
 * throws (non-zero exit) on a non-2xx response.
 */
const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

console.log('TELEGRAM_TOKEN set:', Boolean(token), token ? `(len ${token.length})` : '');
console.log('TELEGRAM_CHAT_ID set:', Boolean(chatId), chatId ? `(len ${chatId.length})` : '');

if (!token || !chatId) {
  throw new Error('Secrets missing — this is the root cause if it throws here.');
}

const text =
  '[Pickle League diagnostic] This is an automated test of the Telegram ' +
  'send mechanism, sent while investigating why GW1/GW2 messages may not ' +
  'have arrived. If you see this, credentials and delivery are working.';

const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: chatId, text })
});

const body = await res.text();
console.log('HTTP status:', res.status, res.statusText);
console.log('Response body:', body);

if (!res.ok) {
  throw new Error(`Telegram send failed: ${res.status} ${body}`);
}
console.log('Telegram send OK — mechanism confirmed working.');
