/** THROWAWAY. Read-only. What shape is `fixtures`, and is GW1 played out? */
const BASE = 'https://draft.premierleague.com/api';
const get = async (p) => {
  const res = await fetch(`${BASE}${p}`, { headers: { 'User-Agent': 'pickle-league/1.0' } });
  if (!res.ok) throw new Error(`GET ${p} -> ${res.status}`);
  return res.json();
};

console.log('now:', new Date().toISOString());
const bs = await get('/bootstrap-static');

console.log('\n=== bs.fixtures shape ===');
console.log('typeof:', typeof bs.fixtures, '| isArray:', Array.isArray(bs.fixtures));
console.log('keys:', bs.fixtures && Object.keys(bs.fixtures).slice(0, 20).join(', '));
console.log('raw (first 600 chars):', JSON.stringify(bs.fixtures).slice(0, 600));

// The dedicated endpoint the classic API uses; may or may not exist on draft.
for (const p of ['/event/1/fixtures', '/fixtures']) {
  try {
    const f = await get(p);
    const list = Array.isArray(f) ? f : f?.data;
    console.log(`\n=== ${p} -> ok, ${Array.isArray(list) ? list.length : 'non-array'} ===`);
    if (Array.isArray(list) && list.length) {
      console.log('one fixture:', JSON.stringify(list[0], null, 2));
      const gw1 = list.filter((x) => x.event === 1);
      console.log(`GW1 count=${gw1.length} finished=${gw1.filter((x) => x.finished).length} ` +
        `provisional=${gw1.filter((x) => x.finished_provisional).length} ` +
        `started=${gw1.filter((x) => x.started).length}`);
      for (const x of gw1) {
        console.log(`  ${x.kickoff_time} started=${x.started} finished=${x.finished} ` +
          `finished_provisional=${x.finished_provisional} ${x.team_h_score}-${x.team_a_score}`);
      }
    }
  } catch (e) {
    console.log(`\n=== ${p} -> ${e.message} ===`);
  }
}
