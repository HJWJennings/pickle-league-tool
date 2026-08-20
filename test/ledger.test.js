/**
 * Run with:  node --test
 * Targets src/ledger.js only: pure functions, no network, no files.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ledgerRows, ledgerCsv } from '../src/ledger.js';

const PICKLE = 3;

const config = () => ({ pickle: { entryId: PICKLE }, fine: { amount: 1, floatStart: 10 } });

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
