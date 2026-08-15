/**
 * Run with:  node --test
 *
 * Uses node:test and node:assert — both built into Node, so this adds no
 * dependencies and needs no install step. Consistent with the zero-dep rule.
 *
 * These target src/pickle.js only: pure functions, no network, no files.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  recordedWeeks,
  missingWeeks,
  finesForWeek,
  fineLedger,
  monthFor,
  monthTable,
  managerOfTheMonth,
  weeklyStats
} from '../src/pickle.js';

const PICKLE = 3; // entry id of the pickle in these fixtures

/** Small helper so fixtures stay readable. */
const state = (gameweeks) => ({ season: 'test', managers: {}, gameweeks });

describe('fines', () => {
  test('scoring strictly lower than the pickle is a fine', () => {
    const s = state({ 1: { 1: 60, 2: 40, 3: 50 } });
    const { fined } = finesForWeek(s, 1, PICKLE, 1);
    assert.deepEqual(
      fined.map((f) => f.entryId),
      [2]
    );
  });

  test('drawing with the pickle is NOT a fine', () => {
    const s = state({ 1: { 1: 50, 2: 50, 3: 50 } });
    const { fined, drew } = finesForWeek(s, 1, PICKLE, 1);
    assert.equal(fined.length, 0, 'nobody should be fined on a draw');
    assert.equal(drew.length, 2);
  });

  test('one point below the pickle is still a fine', () => {
    const s = state({ 1: { 1: 49, 3: 50 } });
    const { fined } = finesForWeek(s, 1, PICKLE, 1);
    assert.equal(fined.length, 1);
  });

  test('a HIGH-scoring pickle fines everyone below them', () => {
    // Counter-intuitive but correct: the better the pickle does, the more
    // people finish below them, and the more the jar collects.
    const s = state({ 1: { 1: 40, 2: 45, 3: 80 } });
    const { fined } = finesForWeek(s, 1, PICKLE, 1);
    assert.equal(fined.length, 2);
  });

  test('a LOW-scoring pickle fines nobody', () => {
    const s = state({ 1: { 1: 40, 2: 45, 3: 20 } });
    const { fined } = finesForWeek(s, 1, PICKLE, 1);
    assert.equal(fined.length, 0);
  });

  test('the pickle never fines themselves', () => {
    const s = state({ 1: { 1: 60, 3: 50 } });
    const { fined } = finesForWeek(s, 1, PICKLE, 1);
    assert.ok(!fined.some((f) => f.entryId === PICKLE));
  });

  test('a gameweek with no data yields no fines', () => {
    const s = state({});
    const { fined, picklePoints } = finesForWeek(s, 7, PICKLE, 1);
    assert.equal(picklePoints, null);
    assert.equal(fined.length, 0);
  });
});

describe('fine ledger', () => {
  const seasonSoFar = state({
    1: { 1: 60, 2: 40, 3: 50 }, // 2 fined
    2: { 1: 30, 2: 70, 3: 50 }, // 1 fined
    3: { 1: 50, 2: 50, 3: 50 } // draw, nobody fined
  });

  test('accumulates across gameweeks', () => {
    const ledger = fineLedger(seasonSoFar, PICKLE, 1);
    assert.equal(ledger.get(1), 1, 'entry 1 fined once (GW2)');
    assert.equal(ledger.get(2), 1, 'entry 2 fined once (GW1)');
  });

  test('IDEMPOTENT: re-recording a gameweek does not double-fine', () => {
    const before = fineLedger(seasonSoFar, PICKLE, 1);

    // Simulate the weekly run overwriting a gameweek it already has —
    // exactly what happens on a re-run or a corrected score.
    const rerun = state({ ...seasonSoFar.gameweeks });
    rerun.gameweeks['1'] = { 1: 60, 2: 40, 3: 50 };

    const after = fineLedger(rerun, PICKLE, 1);
    assert.deepEqual([...after.entries()].sort(), [...before.entries()].sort());
  });

  test('a corrected score changes the ledger retroactively, not additively', () => {
    const corrected = state({ ...seasonSoFar.gameweeks });
    corrected.gameweeks['1'] = { 1: 60, 2: 55, 3: 50 }; // entry 2 now above

    const ledger = fineLedger(corrected, PICKLE, 1);
    assert.equal(ledger.get(2), undefined, 'entry 2 should no longer be fined');
  });
});

describe('months', () => {
  const months = [
    { name: 'August', from: 1, to: 2 },
    { name: 'September', from: 3, to: 5 }
  ];

  test('maps a gameweek to its month, inclusive at both edges', () => {
    assert.equal(monthFor(months, 1).name, 'August');
    assert.equal(monthFor(months, 2).name, 'August');
    assert.equal(monthFor(months, 3).name, 'September');
    assert.equal(monthFor(months, 5).name, 'September');
  });

  test('returns null for a gameweek outside every configured range', () => {
    assert.equal(monthFor(months, 38), null);
  });

  test('totals only the gameweeks inside the range', () => {
    const s = state({
      1: { 1: 50, 2: 40 },
      2: { 1: 30, 2: 60 },
      3: { 1: 99, 2: 99 } // September — must not be counted
    });
    const { table } = monthTable(s, months[0]);
    assert.equal(table.find((r) => r.entryId === 1).points, 80);
    assert.equal(table.find((r) => r.entryId === 2).points, 100);
  });

  test('flags an incomplete month', () => {
    const s = state({ 3: { 1: 50 } }); // Sept needs 3,4,5
    assert.equal(monthTable(s, months[1]).complete, false);
  });

  test('double gameweeks are NOT normalised', () => {
    // A big GW2 score simply counts. Planning for it is part of the game.
    const s = state({ 1: { 1: 40, 2: 40 }, 2: { 1: 95, 2: 40 } });
    const motm = managerOfTheMonth(s, months[0]);
    assert.deepEqual(motm.winners, [1]);
    assert.equal(motm.points, 135);
  });
});

describe('manager of the month', () => {
  const months = [{ name: 'August', from: 1, to: 2 }];

  test('single winner', () => {
    const s = state({ 1: { 1: 50, 2: 40 }, 2: { 1: 50, 2: 40 } });
    const motm = managerOfTheMonth(s, months[0]);
    assert.deepEqual(motm.winners, [1]);
    assert.equal(motm.shared, false);
  });

  test('a tie is shared between everyone level at the top', () => {
    const s = state({ 1: { 1: 50, 2: 40 }, 2: { 1: 40, 2: 50 } });
    const motm = managerOfTheMonth(s, months[0]);
    assert.equal(motm.shared, true);
    assert.deepEqual(motm.winners.sort(), [1, 2]);
  });

  test('a three-way tie is also shared', () => {
    const s = state({ 1: { 1: 45, 2: 45, 3: 45 } , 2: { 1: 45, 2: 45, 3: 45 } });
    const motm = managerOfTheMonth(s, months[0]);
    assert.equal(motm.winners.length, 3);
  });
});

describe('gaps in the record', () => {
  test('spots gameweeks the cron missed', () => {
    const s = state({ 1: {}, 2: {}, 4: {} });
    assert.deepEqual(missingWeeks(s, 4), [3]);
  });

  test('no gaps when the record is complete', () => {
    const s = state({ 1: {}, 2: {}, 3: {} });
    assert.deepEqual(missingWeeks(s, 3), []);
  });

  test('recorded weeks come back in numeric, not string, order', () => {
    const s = state({ 10: {}, 2: {}, 1: {} });
    assert.deepEqual(recordedWeeks(s), [1, 2, 10]);
  });
});

describe('weekly stats', () => {
  const s = state({ 1: { 1: 60, 2: 40, 3: 50 }, 2: { 1: 20, 2: 80, 3: 50 } });

  test('identifies top and bottom for the gameweek', () => {
    const stats = weeklyStats(s, 2);
    assert.equal(stats.top.entryId, 2);
    assert.equal(stats.bottom.entryId, 1);
  });

  test('season table sums all recorded weeks up to that gameweek', () => {
    const stats = weeklyStats(s, 2);
    assert.equal(stats.table.find((r) => r.entryId === 1).points, 80);
    assert.equal(stats.table.find((r) => r.entryId === 2).points, 120);
  });

  test('season table ignores gameweeks after the one being reported', () => {
    const stats = weeklyStats(s, 1);
    assert.equal(stats.table.find((r) => r.entryId === 2).points, 40);
  });

  test('best single score of the season is tracked', () => {
    const stats = weeklyStats(s, 2);
    assert.equal(stats.bestEver.points, 80);
    assert.equal(stats.bestEver.gw, 2);
  });
});
