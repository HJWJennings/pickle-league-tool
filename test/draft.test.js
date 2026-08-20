/**
 * Run with:  node --test
 * Targets src/draft.js: pure, no I/O.
 *
 * Confirmed against the live API and used as fixtures here verbatim:
 *   - an accepted claim: kind 'w', result 'a'
 *   - a denied claim: kind 'w', result 'do' (id 778485, from run #5)
 *   - a player: { id: 1, web_name: 'Raya' }
 *   - the real GW1 batch of 9 accepted + 3 denied (see GW1_TRANSACTIONS)
 *
 * Everything else — other kind/result values, any populated trade — is still
 * unconfirmed, and the tests below pin down that it lands in the
 * "unrecognized" bucket rather than being formatted on a guess.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  validateEndpoints,
  playerName,
  classifyTransactions,
  waiverReport,
  freeAgencyReport,
  newTradeIds,
  tradeReport,
  buildUnrecognizedAlert
} from '../src/draft.js';
import { managerShortLabel } from '../src/message.js';

const realConfig = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));
/** The short "Team Name (XX)" identifier used inside the waiver tables. */
const label = managerShortLabel(realConfig);

// CONFIRMED fixture: a real successful waiver claim, exactly as returned.
const REAL_CLAIM = {
  added: '2026-09-11T11:30:05Z',
  element_in: 490,
  element_out: 193,
  entry: 190207, // Nat Shaughnessy — "Eze Platter" in the real config.json
  event: 4,
  id: 77,
  index: 0,
  kind: 'w',
  priority: 1,
  result: 'a'
};

// CONFIRMED fixture: id 1 is Raya. The other two are invented stand-ins for
// the ids the real claim above references.
const ELEMENTS = [
  { id: 1, web_name: 'Raya' },
  { id: 490, web_name: 'Semenyo' },
  { id: 193, web_name: 'Sels' },
  // Real ids from the GW1 denied records below; names from the league's table.
  { id: 69, web_name: 'Scott' },
  { id: 371, web_name: 'Gravenberch' }
];

/**
 * CONFIRMED fixture: a real DENIED claim, verbatim from the GW1 2026/27 run
 * (workflow run #5). Cross-checked against the league's own results table:
 * entry 1931 is Harry Jennings, and this is his "Scott for Gravenberch —
 * Denied (player out not available)" row. Gravenberch had already been used
 * as the element_out of his earlier ACCEPTED "Kluivert for Gravenberch"
 * claim, so he was no longer there to drop.
 */
const REAL_DENIED = {
  added: '2026-08-20T17:29:59.122187Z',
  element_in: 69,
  element_out: 371,
  entry: 1931,
  event: 1,
  id: 778485,
  index: 12,
  kind: 'w',
  priority: 3,
  result: 'do'
};

const NO_TRANSACTIONS = { transactions: [] };
const NO_TRADES = { trades: [] };

/**
 * The real GW1 2026/27 waiver batch: 9 accepted + 3 denied, exactly the set
 * the live run processed, with the real entry ids and the real player names
 * from the league's results table. Several managers claimed twice (Theo, Rob
 * and Harry), which is what makes this a good alignment fixture.
 *
 * Element ids are real where the live payload showed them (the three denied
 * records, so 316/138, 211/54, 69/371 — hence Kostoulas, Gomes and
 * Gravenberch are real ids); the remaining ids are synthetic stand-ins,
 * since the accepted records were already formatted in the run log.
 */
const GW1_DEADLINE = '2026-08-21T17:30:00Z';

const GW1_ELEMENTS = [
  { id: 316, web_name: 'Emersonn' }, { id: 138, web_name: 'Kostoulas' },
  { id: 211, web_name: 'Yeremy' }, { id: 54, web_name: 'Gomes' },
  { id: 69, web_name: 'Scott' }, { id: 371, web_name: 'Gravenberch' },
  { id: 900, web_name: 'David' }, { id: 901, web_name: 'Welbeck' },
  { id: 902, web_name: 'Wood' }, { id: 903, web_name: 'Wright' },
  { id: 904, web_name: 'Kluivert' }, { id: 905, web_name: 'Ngumoha' },
  { id: 906, web_name: 'Madjo' }, { id: 907, web_name: 'Amad' },
  { id: 908, web_name: 'Neto' }, { id: 909, web_name: 'White' },
  { id: 910, web_name: 'Bijol' }, { id: 911, web_name: 'Konsa' },
  { id: 912, web_name: 'Hall' }, { id: 913, web_name: 'Horníček' },
  { id: 914, web_name: 'Martinez' }
];

const gw1 = (entry, element_in, element_out, result, id) => ({
  added: '2026-08-20T17:29:59.122187Z',
  element_in, element_out, entry, event: 1, id, index: id, kind: 'w', priority: 1, result
});

const GW1_TRANSACTIONS = [
  gw1(197504, 900, 901, 'a', 1), // Rob Wiseman   — David for Welbeck
  gw1(190207, 902, 903, 'a', 2), // Nat           — Wood for Wright
  gw1(1931, 904, 371, 'a', 3), // Harry         — Kluivert for Gravenberch
  gw1(207187, 905, 54, 'a', 4), // Fergus        — Ngumoha for Gomes
  gw1(201762, 906, 138, 'a', 5), // Theo          — Madjo for Kostoulas
  gw1(207411, 907, 908, 'a', 6), // David Cole    — Amad for Neto
  gw1(197504, 909, 910, 'a', 7), // Rob Wiseman   — White for Bijol
  gw1(1931, 911, 912, 'a', 8), // Harry         — Konsa for Hall
  gw1(201762, 913, 914, 'a', 9), // Theo          — Horníček for Martinez
  gw1(201762, 316, 138, 'do', 283995), // Theo   — Emersonn for Kostoulas
  gw1(207187, 211, 54, 'do', 415815), // Fergus — Yeremy for Gomes
  gw1(1931, 69, 371, 'do', 778485) // Harry  — Scott for Gravenberch
];

describe('endpoint config', () => {
  test('the real config.json endpoints carry the configured leagueId', () => {
    assert.doesNotThrow(() => validateEndpoints(realConfig.endpoints, realConfig.leagueId));
  });

  test('throws if an endpoint URL points at a different league than leagueId', () => {
    assert.throws(
      () => validateEndpoints(realConfig.endpoints, 999),
      /does not contain leagueId 999/
    );
  });

  test('throws on a missing endpoint', () => {
    assert.throws(() => validateEndpoints({ trades: 'x/812' }, 812), /transactions is missing/);
    assert.throws(() => validateEndpoints({ transactions: 'x/812' }, 812), /trades is missing/);
  });
});

describe('player lookup (elements[].web_name)', () => {
  test('CONFIRMED fixture: id 1 resolves to "Raya"', () => {
    assert.equal(playerName(ELEMENTS, 1), 'Raya');
  });

  test('matches across string/number ids', () => {
    assert.equal(playerName(ELEMENTS, '1'), 'Raya');
  });

  test('falls back to #id rather than crashing on an unknown player', () => {
    assert.equal(playerName(ELEMENTS, 9999), '#9999');
    assert.equal(playerName([], 1), '#1');
    assert.equal(playerName(undefined, 1), '#1');
  });
});

describe('transaction classification', () => {
  test('CONFIRMED kind "w" + result "a" is a claim', () => {
    const { claims, unrecognized } = classifyTransactions({ transactions: [REAL_CLAIM] }, 4);
    assert.equal(claims.length, 1);
    assert.equal(unrecognized.length, 0);
    assert.equal(claims[0].entry, 190207);
  });

  test('only this gameweek\'s batch is considered', () => {
    const other = { ...REAL_CLAIM, id: 78, event: 5 };
    const { claims, unrecognized } = classifyTransactions(
      { transactions: [REAL_CLAIM, other] },
      4
    );
    assert.equal(claims.length, 1, 'GW5 record must not appear in the GW4 batch');
    assert.equal(unrecognized.length, 0, 'another gameweek is not "unrecognized", just not ours');
  });

  test('an unconfirmed kind (e.g. the presumed "f" for free agents) is unrecognized', () => {
    const freeAgent = { ...REAL_CLAIM, id: 79, kind: 'f' };
    const { claims, unrecognized } = classifyTransactions({ transactions: [freeAgent] }, 4);
    assert.equal(claims.length, 0);
    assert.deepEqual(unrecognized, [freeAgent]);
  });

  test('CONFIRMED result "do" is a denied claim, not unrecognized', () => {
    const { claims, denied, unrecognized } = classifyTransactions(
      { transactions: [REAL_DENIED] },
      1
    );
    assert.equal(claims.length, 0);
    assert.deepEqual(denied, [REAL_DENIED]);
    assert.equal(unrecognized.length, 0);
  });

  test('accepted and denied are separated within one gameweek batch', () => {
    const accepted = { ...REAL_CLAIM, event: 1 };
    const { claims, denied, unrecognized } = classifyTransactions(
      { transactions: [accepted, REAL_DENIED] },
      1
    );
    assert.deepEqual(claims, [accepted]);
    assert.deepEqual(denied, [REAL_DENIED]);
    assert.equal(unrecognized.length, 0);
  });

  test('a still-unconfirmed result value is unrecognized', () => {
    const unknown = { ...REAL_CLAIM, id: 80, result: 'zz' };
    const { claims, denied, unrecognized } = classifyTransactions({ transactions: [unknown] }, 4);
    assert.equal(claims.length, 0);
    assert.equal(denied.length, 0);
    assert.deepEqual(unrecognized, [unknown]);
  });

  test('a denied record missing an id field is unrecognized, not rendered with a hole', () => {
    const partial = { ...REAL_DENIED, element_out: null };
    const { denied, unrecognized } = classifyTransactions({ transactions: [partial] }, 1);
    assert.equal(denied.length, 0);
    assert.equal(unrecognized.length, 1);
  });

  test('a w/a record missing an id field is unrecognized, not rendered with a hole', () => {
    for (const missing of ['entry', 'element_in', 'element_out']) {
      const partial = { ...REAL_CLAIM, id: 81, [missing]: null };
      const { claims, unrecognized } = classifyTransactions({ transactions: [partial] }, 4);
      assert.equal(claims.length, 0, `missing ${missing} must not be treated as a claim`);
      assert.equal(unrecognized.length, 1);
    }
  });

  test('a record with no event at all is unrecognized rather than silently dropped', () => {
    const noEvent = { ...REAL_CLAIM, id: 82, event: null };
    const { unrecognized } = classifyTransactions({ transactions: [noEvent] }, 4);
    assert.deepEqual(unrecognized, [noEvent]);
  });

  test('empty and missing payloads classify as nothing at all', () => {
    const empty = { claims: [], denied: [], unrecognized: [] };
    assert.deepEqual(classifyTransactions(NO_TRANSACTIONS, 4), empty);
    assert.deepEqual(classifyTransactions({}, 4), empty);
    assert.deepEqual(classifyTransactions(undefined, 4), empty);
  });
});

describe('waiver results message', () => {
  test('empty transactions renders a real "no waivers" message', () => {
    const { message, unrecognized } = waiverReport(NO_TRANSACTIONS, 4, { elements: ELEMENTS });
    assert.match(message, /\*🥒 WAIVERS — GW4\*/);
    assert.match(message, /No waivers processed this week\./);
    assert.deepEqual(unrecognized, []);
  });

  test('CONFIRMED accepted fixture renders as a table row, not a bullet', () => {
    const { message, unrecognized } = waiverReport({ transactions: [REAL_CLAIM] }, 4, {
      elements: ELEMENTS,
      label
    });
    assert.match(message, /```/, 'wrapped in a monospace block');
    assert.match(message, /Manager\s+In\s+Out/, 'has a header row');
    // entry 190207 is "Eze Platter (NS)" in the real config.
    assert.match(message, /Eze Platter \(NS\)\s+Semenyo\s+Sels/);
    assert.doesNotMatch(message, /• /, 'bullets replaced by the table');
    assert.deepEqual(unrecognized, []);
  });

  test('CONFIRMED denied fixture renders in a "Missed out" table', () => {
    const { message, unrecognized } = waiverReport({ transactions: [REAL_DENIED] }, 1, {
      elements: ELEMENTS,
      label
    });
    assert.match(message, /\*Missed out\*/);
    assert.match(message, /Mæts back on Semenyo \(HJ\)\s+Scott\s+Gravenberch/);
    assert.deepEqual(unrecognized, [], 'result "do" is confirmed — never bucketed');
  });

  test('uses the short "Team (XX)" identifier, not the full "Team, Manager Name"', () => {
    const { message } = waiverReport({ transactions: [REAL_CLAIM] }, 4, {
      elements: ELEMENTS,
      label
    });
    assert.match(message, /Eze Platter \(NS\)/);
    assert.doesNotMatch(message, /Nat Shaughnessy/, 'full manager name is too wide for a table');
  });

  test('no reason for a denial is invented — the API has no reason field', () => {
    const { message } = waiverReport({ transactions: [REAL_DENIED] }, 1, {
      elements: ELEMENTS,
      label
    });
    assert.doesNotMatch(message, /not available|unavailable|because|reason/i);
  });

  test('NO message when the only records are unrecognized — "no waivers" would be a lie', () => {
    const freeAgent = { ...REAL_CLAIM, id: 79, kind: 'f' };
    const { message, unrecognized } = waiverReport({ transactions: [freeAgent] }, 4, {
      elements: ELEMENTS,
      label
    });
    assert.equal(message, null);
    assert.equal(unrecognized.length, 1);
  });

  test('an unknown manager degrades to #entryId rather than crashing', () => {
    const stranger = { ...REAL_CLAIM, entry: 999999 };
    const { message } = waiverReport({ transactions: [stranger] }, 4, {
      elements: ELEMENTS,
      label
    });
    assert.match(message, /#999999/);
  });
});

describe('waiver tables — the real GW1 2026/27 batch', () => {
  const opts = () => ({ elements: GW1_ELEMENTS, label, deadline: new Date(GW1_DEADLINE) });

  test('one row per claim: managers with two claims get two rows, not one merged row', () => {
    const { message } = waiverReport({ transactions: GW1_TRANSACTIONS }, 1, opts());
    const rows = message.split('\n').filter((l) => /\(HJ\)/.test(l));
    // Harry had two accepted claims and one denied — three separate rows.
    assert.equal(rows.length, 3);
    assert.match(rows[0], /Kluivert/);
    assert.match(rows[1], /Konsa/);
    assert.match(rows[2], /Scott/);
  });

  test('all nine accepted and all three denied rows are present', () => {
    const { message, unrecognized } = waiverReport({ transactions: GW1_TRANSACTIONS }, 1, opts());
    const blocks = message.split('```').filter((_, idx) => idx % 2 === 1);
    assert.equal(blocks.length, 2, 'two separate monospace tables');

    const accepted = blocks[0].trim().split('\n');
    const missed = blocks[1].trim().split('\n');
    assert.equal(accepted.length, 10, 'header + 9 accepted claims');
    assert.equal(missed.length, 4, 'header + 3 denied claims');
    assert.deepEqual(unrecognized, [], 'nothing bucketed — both results are confirmed');
  });

  test('columns align: every row matches an independently recomputed layout', () => {
    const { message } = waiverReport({ transactions: GW1_TRANSACTIONS }, 1, opts());
    const blocks = message.split('```').filter((_, idx) => idx % 2 === 1);

    const expectedBlock = (records) => {
      const cells = [
        ['Manager', 'In', 'Out'],
        ...records.map((r) => [
          label(r.entry),
          GW1_ELEMENTS.find((e) => e.id === r.element_in).web_name,
          GW1_ELEMENTS.find((e) => e.id === r.element_out).web_name
        ])
      ];
      // Recompute widths here rather than reusing the source's helper, so a
      // bug in the padding logic can't cancel itself out.
      const w = [0, 1, 2].map((c) => Math.max(...cells.map((r) => r[c].length)));
      return cells
        .map((r) => `${r[0].padEnd(w[0])} ${r[1].padEnd(w[1])} ${r[2]}`.trimEnd())
        .join('\n');
    };

    const accepted = GW1_TRANSACTIONS.filter((t) => t.result === 'a');
    const denied = GW1_TRANSACTIONS.filter((t) => t.result === 'do');
    assert.equal(blocks[0].trim(), expectedBlock(accepted));
    assert.equal(blocks[1].trim(), expectedBlock(denied));
  });

  test('column widths come from the data, not a hardcoded number', () => {
    const { message } = waiverReport({ transactions: GW1_TRANSACTIONS }, 1, opts());
    // Two managers tie for the widest cell at 25 chars, so the In column
    // starts at 26 on every row of the accepted table.
    const widest = Math.max(
      ...GW1_TRANSACTIONS.filter((t) => t.result === 'a').map((t) => label(t.entry).length)
    );
    assert.equal(widest, 25);
    const row = message.split('\n').find((l) => l.startsWith('Pedro Porro for life (DC)'));
    assert.equal(row.indexOf('Amad'), widest + 1);

    // Drop BOTH 25-char managers and every remaining row must narrow.
    const shorter = GW1_TRANSACTIONS.filter((t) => t.entry !== 207411 && t.entry !== 1931);
    const narrower = waiverReport({ transactions: shorter }, 1, opts()).message;
    const before = message.split('\n').find((l) => l.startsWith('Mr Brobbey (TP)   '));
    const after = narrower.split('\n').find((l) => l.startsWith('Mr Brobbey (TP)'));
    assert.ok(
      after.indexOf('Madjo') < before.indexOf('Madjo'),
      'removing the longest names must pull every later column leftwards'
    );
  });

  test('the free-agency line carries the real deadline in UK local time', () => {
    const { message } = waiverReport({ transactions: GW1_TRANSACTIONS }, 1, opts());
    // 2026-08-21T17:30Z is 18:30 BST — the line must show local, not raw UTC.
    assert.match(message, /Free agents are up for grabs until the GW1 deadline, Fri 21 Aug, 18:30\./);
    assert.doesNotMatch(message, /17:30/, 'raw UTC would read an hour early during BST');
  });

  test('the free-agency line still renders when no deadline is available', () => {
    const { message } = waiverReport({ transactions: GW1_TRANSACTIONS }, 1, {
      elements: GW1_ELEMENTS,
      label
    });
    assert.match(message, /Free agents are up for grabs until the gameweek deadline\./);
  });
});

describe('free agency results message', () => {
  test('empty transactions renders a real "no moves" message', () => {
    const { message, unrecognized } = freeAgencyReport(NO_TRANSACTIONS, 4);
    assert.match(message, /\*🥒 FREE AGENCY — GW4\*/);
    assert.match(message, /No free-agency moves this week\./);
    assert.deepEqual(unrecognized, []);
  });

  test('a payload of only confirmed waivers is "no free-agency moves"', () => {
    // Waivers were already reported by the waiver message; they are not
    // free-agency moves and must not be re-reported as such.
    const { message, unrecognized } = freeAgencyReport({ transactions: [REAL_CLAIM] }, 4);
    assert.match(message, /No free-agency moves this week\./);
    assert.deepEqual(unrecognized, []);
  });

  test('an unconfirmed record sends NO message and buckets it instead', () => {
    const freeAgent = { ...REAL_CLAIM, id: 79, kind: 'f' };
    const { message, unrecognized } = freeAgencyReport({ transactions: [freeAgent] }, 4);
    assert.equal(message, null, 'never guess at the unconfirmed free-agency shape');
    assert.deepEqual(unrecognized, [freeAgent]);
  });
});

describe('trade detection', () => {
  test('empty trades yields nothing to announce and no alert', () => {
    assert.deepEqual(tradeReport(NO_TRADES, []), { unrecognized: [], announceIds: [] });
    assert.deepEqual(tradeReport({}, []), { unrecognized: [], announceIds: [] });
    assert.deepEqual(tradeReport(undefined, []), { unrecognized: [], announceIds: [] });
  });

  test('trades already announced stay silent — no repeat alert', () => {
    const payload = { trades: [{ id: 11 }, { id: 12 }] };
    assert.deepEqual(tradeReport(payload, [11, 12]), { unrecognized: [], announceIds: [] });
  });

  test('ids compare across string/number so a JSON round-trip cannot re-alert', () => {
    const payload = { trades: [{ id: 11 }] };
    assert.deepEqual(newTradeIds(payload, ['11']).fresh, []);
    assert.deepEqual(tradeReport(payload, ['11']).announceIds, []);
  });

  test('a new trade is reported raw and its id returned to be marked announced', () => {
    const payload = { trades: [{ id: 11 }, { id: 12, unconfirmed: 'shape' }] };
    const { unrecognized, announceIds } = tradeReport(payload, [11]);
    assert.deepEqual(announceIds, [12]);
    assert.deepEqual(unrecognized, [{ id: 12, unconfirmed: 'shape' }]);
  });

  test('an id-less trade is reported but cannot be marked handled, so it re-alerts', () => {
    const payload = { trades: [{ no_id_here: true }] };
    const { unrecognized, announceIds } = tradeReport(payload, []);
    assert.deepEqual(unrecognized, [{ no_id_here: true }]);
    assert.deepEqual(announceIds, [], 'nothing to record — unsuppressable until id is known');
  });
});

describe('unrecognized-record alert', () => {
  test('carries the raw records so the real shape is readable off the phone', () => {
    const freeAgent = { ...REAL_CLAIM, kind: 'f' };
    const alert = buildUnrecognizedAlert('transaction records', [freeAgent], { gw: 4 });
    assert.match(alert, /⚠️ PICKLE BOT — unrecognized transaction records/);
    assert.match(alert, /1 record\(s\) for GW4/);
    assert.match(alert, /"kind": "f"/, 'the raw record must be in the alert');
  });

  test('says it will not repeat, so the hourly cron cannot spam', () => {
    const alert = buildUnrecognizedAlert('trade records', [{ id: 1 }]);
    assert.match(alert, /Alerting once only/);
  });

  test('omits the gameweek when there isn\'t one (trades have no gameweek)', () => {
    const alert = buildUnrecognizedAlert('trade records', [{ id: 1 }]);
    assert.doesNotMatch(alert, /for GW/);
  });
});
