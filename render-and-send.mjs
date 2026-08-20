/**
 * THROWAWAY — do not commit. One-off: render the live waiver message with the
 * real, unmodified waiverReport and send it to Telegram so it can be eyeballed
 * on a phone.
 *
 * Reads nothing but config.json. Writes NOTHING: no state.json, no
 * lastWaiverGw, no guards, no commit. Run from the repo root:
 *
 *   TELEGRAM_TOKEN=... TELEGRAM_CHAT_ID=... node render-and-send.mjs [gw]
 */
import { readFile } from 'node:fs/promises';
import { waiverReport } from './src/draft.js';
import { managerInitials } from './src/message.js';
import { gameweekDeadline } from './src/deadlines.js';

const gw = Number(process.argv[2] ?? 1);
const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!token || !chatId) {
  console.error('Set TELEGRAM_TOKEN and TELEGRAM_CHAT_ID first.');
  process.exit(1);
}

const config = JSON.parse(await readFile('./config.json', 'utf8'));

const get = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'pickle-league/1.0' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json();
};
const unwrap = (v) => (Array.isArray(v) ? v : v?.data ?? []);

// 1. Live data, same confirmed endpoints the tool uses.
const bootstrap = await get('https://draft.premierleague.com/api/bootstrap-static');
const transactions = await get(config.endpoints.transactions);

const events = unwrap(bootstrap.events);
const elements = unwrap(bootstrap.elements);
console.error(`Fetched ${(transactions.transactions ?? []).length} transaction(s); rendering GW${gw}.`);

// 2. The real formatting logic, unmodified.
const { message, unrecognized } = waiverReport(transactions, gw, {
  elements,
  label: managerInitials(config),
  deadline: gameweekDeadline(events, gw)
});

if (!message) {
  console.error('waiverReport returned no message (nothing recognizable). Nothing sent.');
  console.error(`unrecognized: ${unrecognized.length}`);
  process.exit(2);
}

console.log('----- EXACT STRING BEING SENT -----');
console.log(message);
console.log('----- END -----');
if (unrecognized.length) console.error(`NOTE: ${unrecognized.length} unrecognized record(s), not shown to the group.`);

// 3. Send. No parse_mode, exactly like index.js, so asterisks arrive literally.
const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: chatId, text: message })
});
const body = await res.text();
if (!res.ok) {
  console.error(`Telegram send FAILED: ${res.status} ${body}`);
  process.exit(3);
}
console.error('Telegram send OK.');
