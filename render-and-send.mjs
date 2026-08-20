/** THROWAWAY — weekly gameweek message, FABRICATED scores. Writes nothing. */
import { readFile } from 'node:fs/promises';
import { buildMessage } from './src/message.js';

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!token || !chatId) { console.error('Missing Telegram env.'); process.exit(1); }

const config = JSON.parse(await readFile('./config.json', 'utf8'));
const state = {
  season: 'PREVIEW',
  lastReportedGw: null,
  managers: {},
  gameweeks: {
    1: { 1931: 65, 2105: 47, 190207: 50, 197504: 44, 201762: 40,
         205835: 47, 205885: 44, 207187: 43, 207411: 59 },
    2: { 1931: 65, 2105: 53, 190207: 60, 197504: 34, 201762: 60,
         205835: 48, 205885: 38, 207187: 60, 207411: 66 }
  }
};

const message =
  '⚠️ *TEST MESSAGE — MADE-UP SCORES, NOT REAL RESULTS. DO NOT FORWARD.*\n\n' +
  buildMessage(state, config, 2);

console.log('----- EXACT STRING BEING SENT -----');
console.log(message);
console.log('----- END -----');

const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: chatId, text: message })
});
const text = await res.text();
if (!res.ok) { console.error(`Telegram FAILED: ${res.status} ${text}`); process.exit(3); }
console.error('Telegram send OK.');
