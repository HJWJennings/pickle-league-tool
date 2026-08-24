/**
 * THROWAWAY. Read-only: is GW1 actually complete on the pitch, and does the
 * Draft API agree? No Telegram, no state write.
 */
const BASE = 'https://draft.premierleague.com/api';
const get = async (p) => {
  const res = await fetch(`${BASE}${p}`, { headers: { 'User-Agent': 'pickle-league/1.0' } });
  if (!res.ok) throw new Error(`GET ${p} -> ${res.status}`);
  return res.json();
};
const unwrap = (v) => (Array.isArray(v) ? v : v?.data);

console.log('now:', new Date().toISOString());

const game = await get('/game');
console.log('\n=== /game ===');
console.log(JSON.stringify(game, null, 2));

const bs = await get('/bootstrap-static');
const events = unwrap(bs.events);
const fixtures = unwrap(bs.fixtures);
const teams = unwrap(bs.teams);
const teamName = new Map((teams ?? []).map((t) => [t.id, t.short_name]));

console.log('\n=== GW1 event ===');
console.log(JSON.stringify(events.find((e) => e.id === 1), null, 2));

console.log('\n=== fixtures container ===');
console.log('fixtures is bare array:', Array.isArray(bs.fixtures), '| count:', fixtures?.length);
console.log('one fixture, all keys:');
console.log(JSON.stringify(fixtures?.[0], null, 2));

const gw1 = (fixtures ?? []).filter((f) => f.event === 1);
console.log(`\n=== GW1 fixtures (${gw1.length}) ===`);
for (const f of gw1) {
  console.log(
    `${teamName.get(f.team_h) ?? f.team_h} v ${teamName.get(f.team_a) ?? f.team_a}  ` +
      `kickoff=${f.kickoff_time} started=${f.started} finished=${f.finished} ` +
      `finished_provisional=${f.finished_provisional} score=${f.team_h_score}-${f.team_a_score}`
  );
}
const unfinished = gw1.filter((f) => f.finished !== true);
console.log(`\nGW1 fixtures not marked finished: ${unfinished.length}`);

console.log('\n=== league standings sanity ===');
const league = await get('/league/812/details');
console.log('managers:', league.league_entries.length);
for (const s of league.standings) {
  const e = league.league_entries.find((x) => x.id === s.league_entry);
  console.log(`  ${e?.entry_id}  ${e?.player_first_name} ${e?.player_last_name}  event_total=${s.event_total}  total=${s.total}`);
}
