/**
 * Run with:  node --test
 * Targets src/message.js's buildMessage: pure formatting, no I/O, no network.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildMessage } from '../src/message.js';

// The real config, so the non-ASCII test below checks what actually ships —
// not a hand-typed copy that could silently drift or get re-normalized.
const realConfig = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));

const PICKLE = 3;

// buildMessage reads display names from config.managers, not state.managers
// (that's ledger.js's source, untouched by this).
const MANAGERS = [
  { entryId: 1, initials: 'A', teamName: 'Team A', managerName: 'Alice' },
  { entryId: 2, initials: 'B', teamName: 'Team B', managerName: 'Bob' },
  { entryId: PICKLE, initials: 'P', teamName: 'Pickle FC', managerName: 'Cormac' }
];

const config = (overrides = {}) => ({
  expectedManagers: 3,
  pickle: { history: [{ fromGw: 1, entryId: PICKLE }] },
  managers: MANAGERS,
  fine: { amount: 1, floatStart: 10, entryFee: 20, lowBalanceWarning: 3 },
  motmMonths: [{ label: 'August', fromGw: 1, toGw: 38 }],
  ...overrides
});

const state = (gameweeks) => ({
  season: 'test',
  lastReportedGw: null,
  managers: {}, // unused by buildMessage — see config.managers above
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
    assert.match(msg, /Running low: Team B - Bob \(£3\)/);
    // And the jar total is unaffected by the float figure: 60 + 7 = 67.
    assert.match(msg, /Total in the jar: £67/);
  });
});

describe('manager display names', () => {
  test('every place a manager is shown uses "{teamName} - {managerName}"', () => {
    const s = state({ 1: { 1: 60, 2: 40, [PICKLE]: 50 } }); // entry 2 fined
    const msg = buildMessage(s, config(), 1);
    assert.match(msg, /\(Pickle FC - Cormac\) scored/); // the pickle line
    assert.match(msg, /• Team B - Bob — 40 pts/); // fines list
    assert.match(msg, /🏆 Top: Team A - Alice — 60/); // top scorer
    assert.match(msg, /1\. Team A - Alice — 60/); // season table
  });

  test('MOTM banner uses the same combined format, not a bare manager name', () => {
    const s = state({ 1: { 1: 60, 2: 40, [PICKLE]: 50 } });
    const msg = buildMessage(s, config({ motmMonths: [{ label: 'August', fromGw: 1, toGw: 1 }] }), 1);
    assert.match(msg, /Team A - Alice — 60 pts/);
  });

  test('a manager missing from config.managers falls back to a bare entryId, not a crash', () => {
    const s = state({ 1: { 1: 60, 2: 40, [PICKLE]: 50 } });
    const msg = buildMessage(s, config({ managers: MANAGERS.filter((m) => m.entryId !== 1) }), 1);
    assert.match(msg, /#1/);
  });

  test('a non-ASCII team name survives unmangled through buildMessage', () => {
    const managers = [
      { entryId: 1, initials: 'HJ', teamName: 'Mæts back on Semenyo', managerName: 'Harry Jennings' },
      { entryId: 2, initials: 'B', teamName: 'Team B', managerName: 'Bob' },
      { entryId: PICKLE, initials: 'P', teamName: 'Pickle FC', managerName: 'Cormac' }
    ];
    const s = state({ 1: { 1: 60, 2: 40, [PICKLE]: 50 } }); // entry 1 tops the week
    const msg = buildMessage(s, config({ managers }), 1);
    assert.match(msg, /Mæts back on Semenyo - Harry Jennings/);
  });

  test('the real config.json survives buildMessage with both non-ASCII team names intact', () => {
    // Real entryIds from config.json: 2105 is the pickle (Cormac R).
    const realState = {
      season: 'test',
      lastReportedGw: null,
      managers: {},
      gameweeks: {
        1: {
          1931: 90, // Harry Jennings — "Mæts back on Semenyo" (æ) — tops the week
          2105: 50, // pickle
          190207: 55,
          197504: 30, // Rob Wiseman — "She’s an Eze Lover" (curly apostrophe, U+2019) — fined
          201762: 55,
          205835: 55,
          205885: 55,
          207187: 55,
          207411: 55
        }
      }
    };
    const msg = buildMessage(realState, realConfig, 1);
    assert.match(msg, /🏆 Top: Mæts back on Semenyo - Harry Jennings — 90/);
    assert.match(msg, /• She’s an Eze Lover - Rob Wiseman — 30 pts/);
    // Prove it's the real curly apostrophe (U+2019), not a straight quote a
    // copy/paste or a JSON round-trip could have silently normalized away.
    assert.equal(realConfig.managers.find((m) => m.entryId === 197504).teamName.includes('’'), true);
  });
});
