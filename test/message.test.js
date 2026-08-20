/**
 * Run with:  node --test
 * Targets src/message.js's buildMessage: pure formatting, no I/O, no network.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildMessage } from '../src/message.js';

const PICKLE = 3;

const config = (overrides = {}) => ({
  expectedManagers: 3,
  pickle: { history: [{ fromGw: 1, entryId: PICKLE }] },
  fine: { amount: 1, floatStart: 10, entryFee: 20, lowBalanceWarning: 3 },
  motmMonths: [{ label: 'August', fromGw: 1, toGw: 38 }],
  ...overrides
});

const state = (gameweeks) => ({
  season: 'test',
  lastReportedGw: null,
  managers: {
    1: { teamName: 'Team A', manager: 'Alice' },
    2: { teamName: 'Team B', manager: 'Bob' },
    3: { teamName: 'Pickle FC', manager: 'Cormac' }
  },
  gameweeks
});

describe('pickle jar total', () => {
  test('starts at entryFee * expectedManagers when nobody has been fined', () => {
    const s = state({ 1: { 1: 60, 2: 50, 3: 50 } }); // nobody below the pickle (50)
    const msg = buildMessage(s, config(), 1);
    assert.match(msg, /Total in the jar: £60/); // £20 × 3 managers, no fines
  });

  test('grows by fine.amount per fine, on top of the entry pool', () => {
    const s = state({ 1: { 1: 60, 2: 40, 3: 50 } }); // entry 2 fined (40 < 50)
    const msg = buildMessage(s, config(), 1);
    assert.match(msg, /Total in the jar: £61/); // 60 + 1 fine
  });

  test('recomputed fresh across the season, not accumulated incrementally', () => {
    const s = state({
      1: { 1: 60, 2: 40, 3: 50 }, // entry 2 fined
      2: { 1: 30, 2: 70, 3: 50 } // entry 1 fined
    });
    const msg = buildMessage(s, config(), 2);
    assert.match(msg, /Total in the jar: £62/); // 60 + 2 fines
  });

  test('scales with expectedManagers, not a hardcoded pool size', () => {
    const s = state({ 1: { 1: 60, 2: 50, 3: 50 } });
    const msg = buildMessage(s, config({ expectedManagers: 9 }), 1);
    assert.match(msg, /Total in the jar: £180/); // £20 × 9
  });

  test('a corrected score changes the jar total retroactively, not additively', () => {
    const fined = state({ 1: { 1: 60, 2: 40, 3: 50 } });
    const corrected = state({ 1: { 1: 60, 2: 55, 3: 50 } }); // entry 2 now above the pickle

    assert.match(buildMessage(fined, config(), 1), /Total in the jar: £61/);
    assert.match(buildMessage(corrected, config(), 1), /Total in the jar: £60/);
  });

  test('heading drops the word "float" — jar and float are separate figures', () => {
    const s = state({ 1: { 1: 60, 2: 50, 3: 50 } });
    const msg = buildMessage(s, config(), 1);
    assert.match(msg, /\*Pickle jar\*/);
    assert.doesNotMatch(msg, /Pickle jar float/);
  });

  test('the per-manager float low-balance warning is untouched by the jar change', () => {
    const gameweeks = {};
    for (let gw = 1; gw <= 7; gw++) {
      gameweeks[gw] = { 1: 60, 2: 40, 3: 50 }; // entry 2 fined every week
    }
    const msg = buildMessage(state(gameweeks), config(), 7);
    // entry 2's £10 float: 10 - 7 fines = £3, at the lowBalanceWarning threshold.
    assert.match(msg, /Running low: Team B \(£3\)/);
    // And the jar total is unaffected by the float figure: 60 + 7 = 67.
    assert.match(msg, /Total in the jar: £67/);
  });
});
