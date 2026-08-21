/**
 * Run with:  node --test
 * Targets src/message.js's buildMessage: pure formatting, no I/O, no network.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildMessage, managerName, managerInitials } from '../src/message.js';

// The real config, so the non-ASCII checks below exercise what actually
// ships rather than a hand-typed copy that could drift.
const realConfig = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));

const PICKLE = 3;

const MANAGERS = [
  { entryId: 1, initials: 'AL', teamName: 'Team A', managerName: 'Alice' },
  { entryId: 2, initials: 'BO', teamName: 'Team B', managerName: 'Bob' },
  { entryId: PICKLE, initials: 'CO', teamName: 'Pickle FC', managerName: 'Cormac' }
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
  managers: {}, // unused by buildMessage — see config.managers
  gameweeks
});

describe('manager identifiers', () => {
  test('managerName gives the plain name; managerInitials gives the initials', () => {
    assert.equal(managerName(realConfig)(1931), 'Harry Jennings');
    assert.equal(managerInitials(realConfig)(1931), 'HJ');
  });

  test('both fall back to #entryId rather than crashing', () => {
    assert.equal(managerName(realConfig)(999999), '#999999');
    assert.equal(managerInitials(realConfig)(999999), '#999999');
  });
});

describe('message shape', () => {
  const s = state({ 1: { 1: 60, 2: 40, [PICKLE]: 50 } }); // entry 2 fined

  test('header says RESULTS', () => {
    assert.match(buildMessage(s, config(), 1), /^\*🥒 PICKLE LEAGUE — GW1 RESULTS\*/);
  });

  test('the pickle line is "*The Pickle (II)*" — no team name, no manager name', () => {
    const msg = buildMessage(s, config(), 1);
    assert.match(msg, /\*The Pickle \(CO\)\* scored \*50\*/);
    assert.doesNotMatch(msg, /Pickle FC/, 'team name is gone from the message entirely');
    assert.doesNotMatch(msg, /The Pickle \(CO\)\* \(/, 'no leftover bracket from the old form');
  });

  test('fines are listed by initials alone', () => {
    const msg = buildMessage(s, config(), 1);
    assert.match(msg, /• BO — 40 pts/);
    assert.doesNotMatch(msg, /• \*Team B\*/, 'no team name on a fine line');
    assert.doesNotMatch(msg, /• Bob/, 'no full name on a fine line');
  });

  test('top and worst are "points - manager", points first', () => {
    const msg = buildMessage(s, config(), 1);
    assert.match(msg, /🏆 Top: \*60\* - Alice/);
    assert.match(msg, /💩 Worst: \*40\* - Bob/);
  });

  test('the jar line reads "Pot:"', () => {
    const msg = buildMessage(s, config(), 1);
    assert.match(msg, /Pot: £61/); // 20 x 3 + 1 fine
    assert.doesNotMatch(msg, /Total in the jar/);
  });

  test('the low-balance warning uses initials', () => {
    const gameweeks = {};
    for (let gw = 1; gw <= 7; gw++) gameweeks[gw] = { 1: 60, 2: 40, [PICKLE]: 50 };
    const msg = buildMessage(state(gameweeks), config(), 7);
    assert.match(msg, /Running low: BO \(£3\)/);
  });

  test('a draw is reported by initials and still charges nobody', () => {
    const drawn = state({ 1: { 1: 60, 2: 50, [PICKLE]: 50 } });
    const msg = buildMessage(drawn, config(), 1);
    assert.match(msg, /Level with the pickle, no fine: BO/);
    assert.match(msg, /Pot: £60/, 'a draw adds nothing to the pot');
  });
});

describe('season table', () => {
  const s = state({
    1: { 1: 60, 2: 40, [PICKLE]: 50 },
    2: { 1: 60, 2: 40, [PICKLE]: 50 }
  });

  test('ranked lines are "N. points - manager"', () => {
    const msg = buildMessage(s, config(), 2);
    const lines = msg.split('\n');
    const start = lines.indexOf('*Season table*');
    assert.ok(start > -1);
    // one blank line, then the ranking
    assert.equal(lines[start + 1], '');
    assert.deepEqual(lines.slice(start + 2, start + 5), [
      '1. *120* - Alice',
      '2. *100* - Cormac',
      '3. *80* - Bob'
    ]);
  });

  test('no monospace block — it would arrive as literal backticks in Telegram', () => {
    assert.doesNotMatch(buildMessage(s, config(), 2), /```/);
  });

  test('no team names in any ranked line', () => {
    const msg = buildMessage(s, config(), 2);
    const lines = msg.split('\n');
    // Both the month race and the season table produce ranked lines; neither
    // should carry a team name.
    const ranked = lines.filter((l) => /^\d+\. /.test(l));
    assert.equal(ranked.length, 6, 'three for the August race, three for the season');
    for (const line of ranked) assert.doesNotMatch(line, /Team [AB]|Pickle FC/);

    const start = lines.indexOf('*Season table*');
    assert.equal(lines.slice(start + 2, start + 5).length, 3);
  });
});

describe('manager of the month', () => {
  const s = state({ 1: { 1: 60, 2: 40, [PICKLE]: 50 } });

  test('a complete month announces "MOTM", not "Manager of the Month"', () => {
    const msg = buildMessage(s, config({ motmMonths: [{ label: 'August', fromGw: 1, toGw: 1 }] }), 1);
    assert.match(msg, /\*🏅 August MOTM\*/);
    assert.match(msg, /Alice - \*60 pts\*/);
    assert.doesNotMatch(msg, /Manager of the Month/);
  });

  test('a shared month names every winner and says the prize splits', () => {
    const tied = state({ 1: { 1: 50, 2: 50, [PICKLE]: 40 } });
    const msg = buildMessage(tied, config({ motmMonths: [{ label: 'August', fromGw: 1, toGw: 1 }] }), 1);
    assert.match(msg, /Alice & Bob - \*50 pts each\*/);
    assert.match(msg, /_Shared, prize splits\._/);
  });

  test('an incomplete month shows the race in the same ranked form', () => {
    const msg = buildMessage(s, config({ motmMonths: [{ label: 'August', fromGw: 1, toGw: 2 }] }), 1);
    assert.match(msg, /\*August race \(GW1–2\)\*/);
    assert.match(msg, /1\. \*60\* - Alice/);
  });
});

describe('the real config.json', () => {
  // Real entry ids: 2105 is the pickle (Cormac R, "Better Call Tzol").
  const realState = {
    season: 'test',
    lastReportedGw: null,
    managers: {},
    gameweeks: {
      1: {
        1931: 90, // Harry Jennings — "Mæts back on Semenyo" (æ)
        2105: 50, // pickle
        190207: 55,
        197504: 30, // Rob Wiseman — "She's an Eze Lover" (U+2019)
        201762: 55,
        205835: 55,
        205885: 55,
        207187: 55,
        207411: 55
      }
    }
  };

  test('renders real managers by name, with no team names in the ranking', () => {
    const msg = buildMessage(realState, realConfig, 1);
    assert.match(msg, /🏆 Top: \*90\* - Harry Jennings/);
    assert.match(msg, /💩 Worst: \*30\* - Rob Wiseman/);
    assert.match(msg, /1\. \*90\* - Harry Jennings/);
    assert.doesNotMatch(msg, /Mæts back on Semenyo/, 'team names no longer appear in prose');
    assert.doesNotMatch(msg, /She’s an Eze Lover/);
  });

  test('the pickle line shows initials only', () => {
    const msg = buildMessage(realState, realConfig, 1);
    assert.match(msg, /\*The Pickle \(CR\)\* scored \*50\*/);
  });

  test('fines list the real initials', () => {
    const msg = buildMessage(realState, realConfig, 1);
    assert.match(msg, /• RW — 30 pts/);
  });

  test('no team name reaches the message at all', () => {
    // teamName is still in config.managers for reference, but nothing renders
    // it any more — which is what keeps `æ` and a curly apostrophe out of
    // lines that have to hold their shape.
    const msg = buildMessage(realState, realConfig, 1);
    for (const m of realConfig.managers) {
      assert.ok(!msg.includes(m.teamName), `${m.teamName} must not appear`);
    }
  });
});
