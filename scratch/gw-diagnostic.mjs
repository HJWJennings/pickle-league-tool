/**
 * THROWAWAY. Read-only: prints the two payloads that decide whether the
 * weekly report sends. No Telegram, no state write.
 */
const BASE = 'https://draft.premierleague.com/api';
const get = async (p) => {
  const res = await fetch(`${BASE}${p}`, { headers: { 'User-Agent': 'pickle-league/1.0' } });
  if (!res.ok) throw new Error(`GET ${p} -> ${res.status}`);
  return res.json();
};

console.log('now:', new Date().toISOString());

const game = await get('/game');
console.log('\n=== /game (full) ===');
console.log(JSON.stringify(game, null, 2));

const bs = await get('/bootstrap-static');
const events = Array.isArray(bs.events) ? bs.events : bs.events?.data;
console.log('\n=== bootstrap-static: events container ===');
console.log('top-level keys:', Object.keys(bs).join(', '));
console.log('events is bare array:', Array.isArray(bs.events));

console.log('\n=== GW1 event (full) ===');
console.log(JSON.stringify(events.find((e) => e.id === 1), null, 2));

console.log('\n=== GW1-3 flag summary ===');
for (const e of events.filter((e) => e.id <= 3)) {
  console.log(
    `GW${e.id}: finished=${e.finished} finished_provisional=${e.finished_provisional} ` +
      `data_checked=${e.data_checked} is_current=${e.is_current} is_next=${e.is_next} ` +
      `deadline=${e.deadline_time}`
  );
}

console.log('\n=== what index.js would decide ===');
console.log(`game.current_event = ${game.current_event}`);
console.log(`game.current_event_finished = ${game.current_event_finished}`);
console.log(
  `guard \`game.finished === false\` -> ${(game.current_event_finished ?? null) === false ? 'BAIL (no report)' : 'proceed'}`
);
