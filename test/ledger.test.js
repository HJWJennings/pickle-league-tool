/**
 * Run with:  node --test
 * Targets src/ledger.js only: pure functions, no network, no files.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ledgerRows, ledgerCsv } from '../src/ledger.js';

const PICKLE = 3;

const config = (history = [{ fromGw: 1, entryId: PICKLE }]) => ({
  pickle: { history },
  fine: { amount: 1, floatStart: 10 }
});

const state = (gameweeks, managers = {}) => ({ season: 'test', managers, gameweeks });

describe('ledger rows', () => {
  test('one row per manager per recorded gameweek', () => {
    const s = state({ 1: { 1: 60, 2: 40, 3: 50 } });
    const rows = ledgerRows(s, config());
    assert.equal(rows.length, 3);
  });

  test('marks the fined row and leaves the rest unfined', () => {
    const s = state({ 1: { 1: 60, 2: 40, 3: 50 } });
    const rows = ledgerRows(s, config());
    assert.equal(rows.find((r) => r.entryId === 2).fined, true);
    assert.equal(rows.find((r) => r.entryId === 1).fined, false);
    assert.equal(rows.find((r) => r.entryId === PICKLE).fined, false);
  });

  test('balance decrements only on fined weeks and carries forward', () => {
    const s = state({
      1: { 1: 60, 2: 40, 3: 50 }, // entry 2 fined
      2: { 1: 30, 2: 70, 3: 50 } // entry 1 fined
    });
    const rows = ledgerRows(s, config());

    const e1gw1 = rows.find((r) => r.entryId === 1 && r.gw === 1);
    const e1gw2 = rows.find((r) => r.entryId === 1 && r.gw === 2);
    assert.equal(e1gw1.balance, 10, 'not fined in GW1, still on full float');
    assert.equal(e1gw2.balance, 9, 'fined in GW2, float decremented');

    const e2gw1 = rows.find((r) => r.entryId === 2 && r.gw === 1);
    const e2gw2 = rows.find((r) => r.entryId === 2 && r.gw === 2);
    assert.equal(e2gw1.balance, 9, 'fined in GW1');
    assert.equal(e2gw2.balance, 9, 'not fined in GW2, balance carries forward unchanged');
  });

  test('a corrected score changes the ledger retroactively, not additively', () => {
    const s1 = state({ 1: { 1: 60, 2: 40, 3: 50 } });
    const before = ledgerRows(s1, config()).find((r) => r.entryId === 2).balance;

    const s2 = state({ 1: { 1: 60, 2: 55, 3: 50 } }); // entry 2 now above the pickle
    const after = ledgerRows(s2, config()).find((r) => r.entryId === 2).balance;

    assert.equal(before, 9);
    assert.equal(after, 10, 'no longer fined once the score is corrected');
  });

  test('team name and manager come from state.managers', () => {
    const s = state(
      { 1: { 1: 60, 3: 50 } },
      { 1: { teamName: 'Team A', manager: 'Alice' } }
    );
    const row = ledgerRows(s, config())[0];
    assert.equal(row.teamName, 'Team A');
    assert.equal(row.manager, 'Alice');
  });

  test('a later pickle change does not rewrite already-recorded early gameweeks (backfill regression)', () => {
    const OLD_PICKLE = 3;
    const NEW_PICKLE = 9;

    // Recorded raw points, exactly as a backfill from state.json would see
    // them — every manager's score for every week, regardless of who was
    // the pickle at the time.
    const s = state({
      1: { 1: 60, 2: 40, [OLD_PICKLE]: 50, [NEW_PICKLE]: 45 },
      2: { 1: 30, 2: 70, [OLD_PICKLE]: 50, [NEW_PICKLE]: 55 },
      3: { 1: 60, 2: 40, [OLD_PICKLE]: 50, [NEW_PICKLE]: 45 },
      4: { 1: 20, 2: 70, [OLD_PICKLE]: 50, [NEW_PICKLE]: 45 }
    });

    // "Before": as things stood while only the old pickle was ever configured.
    const before = ledgerRows(s, config([{ fromGw: 1, entryId: OLD_PICKLE }]));
    const beforeGw1 = before.filter((r) => r.gw === 1);
    const beforeGw2 = before.filter((r) => r.gw === 2);

    // A second history entry is added for GW3 onward, and the full history
    // (GW1-4) is recomputed from state.json in one go, as a backfill would.
    const after = ledgerRows(
      s,
      config([
        { fromGw: 1, entryId: OLD_PICKLE },
        { fromGw: 3, entryId: NEW_PICKLE }
      ])
    );
    const afterGw1 = after.filter((r) => r.gw === 1);
    const afterGw2 = after.filter((r) => r.gw === 2);
    const afterGw3 = after.filter((r) => r.gw === 3);
    const afterGw4 = after.filter((r) => r.gw === 4);

    // Early gameweeks (before the new entry's fromGw) are byte-for-byte
    // unchanged by adding a later history entry.
    assert.deepEqual(afterGw1, beforeGw1, 'GW1 rows must match the pre-change run exactly');
    assert.deepEqual(afterGw2, beforeGw2, 'GW2 rows must match the pre-change run exactly');
    assert.ok(
      afterGw1.every((r) => r.picklePoints === 50) && afterGw2.every((r) => r.picklePoints === 50),
      'GW1-2 still measured against the old pickle\'s score'
    );

    // Later gameweeks (from the new entry's fromGw) use the new pickle.
    assert.ok(
      afterGw3.every((r) => r.picklePoints === 45) && afterGw4.every((r) => r.picklePoints === 45),
      'GW3-4 measured against the new pickle\'s score'
    );

    // And the fine outcome for each week reflects the pickle that actually applied then.
    assert.equal(afterGw1.find((r) => r.entryId === 2).fined, true, 'GW1: 40 < old pickle 50');
    assert.equal(afterGw2.find((r) => r.entryId === 1).fined, true, 'GW2: 30 < old pickle 50');
    assert.equal(afterGw3.find((r) => r.entryId === 2).fined, true, 'GW3: 40 < new pickle 45');
    assert.equal(afterGw4.find((r) => r.entryId === 1).fined, true, 'GW4: 20 < new pickle 45');
  });
});

describe('ledger csv', () => {
  test('has a header row and one line per data row', () => {
    const s = state({ 1: { 1: 60, 2: 40, 3: 50 } });
    const csv = ledgerCsv(s, config());
    const lines = csv.trim().split('\n');
    assert.equal(lines[0], 'Season,GW,Team,Manager,Points,PicklePoints,Fined,Balance');
    assert.equal(lines.length, 4); // header + 3 managers
  });

  test('empty state produces header only', () => {
    const csv = ledgerCsv(state({}), config());
    assert.equal(csv.trim(), 'Season,GW,Team,Manager,Points,PicklePoints,Fined,Balance');
  });

  test('quotes a team name containing a comma', () => {
    const s = state({ 1: { 1: 60, 3: 50 } }, { 1: { teamName: 'Foo, Bar', manager: '' } });
    const csv = ledgerCsv(s, config());
    assert.match(csv, /"Foo, Bar"/);
  });
});
