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
import { managerInitials } from '../src/message.js';

const realConfig = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));
/** Initials — the identifier used on the waiver lines. */
const label = managerInitials(realConfig);

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

  test('CONFIRMED accepted fixture renders as "II<tab>Out → In"', () => {
    const { message, unrecognized } = waiverReport({ transactions: [REAL_CLAIM] }, 4, {
      elements: ELEMENTS,
      label
    });
    // entry 190207 is NS. element_out 193 = Sels leaves, element_in 490 = Semenyo arrives.
    assert.ok(message.includes('NS\tSels → Semenyo'), 'out first, then arrow, then in');
    assert.deepEqual(unrecognized, []);
  });

  test('no monospace block — it arrives as literal backticks in Telegram', () => {
    const { message } = waiverReport({ transactions: [REAL_CLAIM] }, 4, {
      elements: ELEMENTS,
      label
    });
    assert.doesNotMatch(message, /```/);
  });

  test('uses initials alone, not the manager or team name', () => {
    const { message } = waiverReport({ transactions: [REAL_CLAIM] }, 4, {
      elements: ELEMENTS,
      label
    });
    assert.doesNotMatch(message, /Nat Shaughnessy/);
    assert.doesNotMatch(message, /Eze Platter/);
  });

  test('CONFIRMED denied fixture renders under "Missed out" in the same shape', () => {
    const { message, unrecognized } = waiverReport({ transactions: [REAL_DENIED] }, 1, {
      elements: ELEMENTS,
      label
    });
    assert.match(message, /\*Missed out\*/);
    assert.ok(message.includes('HJ\tGravenberch → Scott'));
    assert.deepEqual(unrecognized, [], 'result "do" is confirmed — never bucketed');
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

describe('waiver lines — the real GW1 2026/27 batch', () => {
  const opts = () => ({ elements: GW1_ELEMENTS, label, deadline: new Date(GW1_DEADLINE) });

  test('renders every one of the 9 accepted and 3 denied claims', () => {
    const { message, unrecognized } = waiverReport({ transactions: GW1_TRANSACTIONS }, 1, opts());
    const claimLines = message.split('\n').filter((l) => l.includes('\t'));
    assert.equal(claimLines.length, 12);
    assert.deepEqual(unrecognized, [], 'both results are confirmed — nothing bucketed');
  });

  test('one line per claim: a manager who claimed twice gets two lines', () => {
    const { message } = waiverReport({ transactions: GW1_TRANSACTIONS }, 1, opts());
    const hj = message.split('\n').filter((l) => l.startsWith('HJ\t'));
    assert.deepEqual(hj, [
      'HJ\tGravenberch → Kluivert',
      'HJ\tHall → Konsa',
      'HJ\tGravenberch → Scott'
    ]);
  });

  test('every line is initials, one tab, then exactly one arrow', () => {
    const { message } = waiverReport({ transactions: GW1_TRANSACTIONS }, 1, opts());
    for (const line of message.split('\n').filter((l) => l.includes('\t'))) {
      assert.match(line, /^[A-Z]{2}\t[^\t]+ → [^\t]+$/, line);
      assert.equal(line.split('\t').length, 2, 'exactly one tab');
      assert.equal(line.split(' → ').length, 2, 'exactly one arrow');
    }
  });

  test('needs no padding: the identifier is two chars on every single line', () => {
    const { message } = waiverReport({ transactions: GW1_TRANSACTIONS }, 1, opts());
    const widths = new Set(
      message.split('\n').filter((l) => l.includes('\t')).map((l) => l.split('\t')[0].length)
    );
    assert.deepEqual([...widths], [2], 'uniform width is what makes this hold shape');
  });

  test('lines stay short enough not to wrap on a phone', () => {
    const { message } = waiverReport({ transactions: GW1_TRANSACTIONS }, 1, opts());
    const longest = Math.max(
      ...message.split('\n').filter((l) => l.includes('\t')).map((l) => l.length)
    );
    assert.ok(longest <= 32, `longest claim line is ${longest} chars`);
  });

  test('the free-agency line carries the real deadline in UK local time', () => {
    const { message } = waiverReport({ transactions: GW1_TRANSACTIONS }, 1, opts());
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
