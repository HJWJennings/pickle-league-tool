/**
 * THROWAWAY, read-only. Question: is `result: "di"` a denial?
 *
 * Not by guessing what the letters abbreviate — by checking whether the
 * records are CONSISTENT with a denial and INCONSISTENT with an acceptance.
 * Two independent checks:
 *   1. Uniqueness. A player can join only one squad. If several managers'
 *      claims for the same element_in all read "di", they cannot all be
 *      acceptances.
 *   2. Precedence. If a "di" claim's element_in was already taken by an
 *      ACCEPTED claim at a lower `index` (confirmed processing order), that
 *      is the same shape of evidence that confirmed "do" on the out-side.
 */
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));
const get = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'pickle-league/1.0' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
};
const unwrap = (v) => (Array.isArray(v) ? v : v?.data);

const bs = await get('https://draft.premierleague.com/api/bootstrap-static');
const elements = unwrap(bs.elements);
const nameOf = new Map(elements.map((e) => [e.id, e.web_name]));
const who = new Map((config.managers ?? []).map((m) => [m.entryId, m.initials]));

const payload = await get(config.endpoints.transactions);
const all = payload.transactions ?? [];
const gw2 = all.filter((t) => Number(t.event) === 2).sort((a, b) => a.index - b.index);

console.log(`GW2 records: ${gw2.length}`);
const byResult = {};
for (const t of gw2) byResult[t.result] = (byResult[t.result] ?? 0) + 1;
console.log('result tally:', JSON.stringify(byResult));

console.log('\n=== every GW2 record in processing order ===');
console.log('idx  pri  mgr  result  out -> in');
for (const t of gw2) {
  console.log(
    `${String(t.index).padStart(3)}  ${String(t.priority).padStart(3)}  ` +
      `${(who.get(t.entry) ?? '??').padEnd(3)}  ${String(t.result).padEnd(6)}  ` +
      `${nameOf.get(t.element_out) ?? t.element_out} -> ${nameOf.get(t.element_in) ?? t.element_in}`
  );
}

const accepted = gw2.filter((t) => t.result === 'a');

console.log('\n=== CHECK 1: uniqueness (can several "di" be acceptances?) ===');
const inCounts = new Map();
for (const t of gw2) {
  if (!inCounts.has(t.element_in)) inCounts.set(t.element_in, []);
  inCounts.get(t.element_in).push(t);
}
let contested = 0;
for (const [el, recs] of inCounts) {
  if (recs.length < 2) continue;
  contested++;
  const tally = recs.map((r) => `${who.get(r.entry) ?? r.entry}:${r.result}@${r.index}`).join('  ');
  const nAccepted = recs.filter((r) => r.result === 'a').length;
  console.log(`${nameOf.get(el) ?? el}: ${tally}   (accepted: ${nAccepted})`);
}
console.log(contested === 0 ? '(no contested players)' : '');

console.log('\n=== CHECK 2: precedence — was the "di" in-player already won earlier? ===');
const di = gw2.filter((t) => t.result === 'di');
let explained = 0;
for (const t of di) {
  const winner = accepted.find((a) => a.element_in === t.element_in && a.index < t.index);
  const label = `${who.get(t.entry) ?? t.entry} @${t.index} wanted ${nameOf.get(t.element_in)}`;
  if (winner) {
    explained++;
    console.log(
      `  EXPLAINED  ${label} — already taken by ` +
        `${who.get(winner.entry) ?? winner.entry} (accepted @${winner.index})`
    );
  } else {
    const anyEarlier = gw2.find(
      (o) => o.element_in === t.element_in && o.index < t.index
    );
    console.log(
      `  unexplained ${label}` +
        (anyEarlier
          ? ` — earlier claim @${anyEarlier.index} by ${who.get(anyEarlier.entry)} was "${anyEarlier.result}"`
          : ' — no earlier claim for this player at all')
    );
  }
}
console.log(`\n"di" records: ${di.length}, explained by an earlier accepted claim: ${explained}`);

console.log('\n=== CHECK 3: does any manager appear with BOTH "a" and "di"? ===');
for (const entry of new Set(gw2.map((t) => t.entry))) {
  const mine = gw2.filter((t) => t.entry === entry);
  const rs = mine.map((m) => m.result);
  console.log(
    `  ${who.get(entry) ?? entry}: ${rs.join(', ')}  ` +
      `(a=${rs.filter((r) => r === 'a').length} do=${rs.filter((r) => r === 'do').length} di=${rs.filter((r) => r === 'di').length})`
  );
}
