/**
 * Run with:  node --test
 * Targets src/draft.js: pure, no I/O.
 *
 * Two shapes are CONFIRMED against the live API and are used as fixtures here
 * verbatim:
 *   - a transaction record: entry 190207, kind 'w', result 'a',
 *     element_in 490, element_out 193
 *   - a player: { id: 1, web_name: 'Raya' }
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
import { managerDisplay } from '../src/message.js';

const realConfig = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));
const display = managerDisplay(realConfig);

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

  test('CONFIRMED fixture renders as "{manager} claimed {in} for {out}"', () => {
    const { message, unrecognized } = waiverReport({ transactions: [REAL_CLAIM] }, 4, {
      elements: ELEMENTS,
      display
    });
    // entry 190207 is "Eze Platter" / Nat Shaughnessy in the real config.
    assert.match(message, /• \*Eze Platter\*, Nat Shaughnessy claimed Semenyo for Sels/);
    assert.deepEqual(unrecognized, []);
  });

  test('uses the same bold-team, comma-manager format as the weekly message', () => {
    const { message } = waiverReport({ transactions: [REAL_CLAIM] }, 4, {
      elements: ELEMENTS,
      display
    });
    assert.equal(message.includes(display(190207)), true);
  });

  test('resolves the CONFIRMED Raya fixture through a real claim', () => {
    const claim = { ...REAL_CLAIM, element_in: 1 };
    const { message } = waiverReport({ transactions: [claim] }, 4, {
      elements: ELEMENTS,
      display
    });
    assert.match(message, /claimed Raya for Sels/);
  });

  test('groups two claims by the same manager onto one line', () => {
    const second = { ...REAL_CLAIM, id: 78, index: 1, element_in: 1, element_out: 490 };
    const { message } = waiverReport({ transactions: [REAL_CLAIM, second] }, 4, {
      elements: ELEMENTS,
      display
    });
    const lines = message.split('\n').filter((l) => l.startsWith('•'));
    assert.equal(lines.length, 1, 'one manager, one bullet');
    assert.match(lines[0], /claimed Semenyo for Sels, Raya for Semenyo/);
  });

  test('separate managers get separate bullets', () => {
    const other = { ...REAL_CLAIM, id: 78, entry: 1931, element_in: 1 };
    const { message } = waiverReport({ transactions: [REAL_CLAIM, other] }, 4, {
      elements: ELEMENTS,
      display
    });
    const lines = message.split('\n').filter((l) => l.startsWith('•'));
    assert.equal(lines.length, 2);
    assert.match(lines[1], /\*Mæts back on Semenyo\*, Harry Jennings claimed Raya/);
  });

  test('an unknown manager degrades to #entryId rather than crashing', () => {
    const stranger = { ...REAL_CLAIM, entry: 999999 };
    const { message } = waiverReport({ transactions: [stranger] }, 4, {
      elements: ELEMENTS,
      display
    });
    assert.match(message, /#999999 claimed/);
  });

  test('unrecognized records are bucketed, never formatted', () => {
    const freeAgent = { ...REAL_CLAIM, id: 79, kind: 'f' };
    const { message, unrecognized } = waiverReport(
      { transactions: [REAL_CLAIM, freeAgent] },
      4,
      { elements: ELEMENTS, display }
    );
    assert.match(message, /claimed Semenyo for Sels/, 'the confirmed claim still reports');
    assert.deepEqual(unrecognized, [freeAgent], 'the unconfirmed one is set aside');
    assert.doesNotMatch(message, /"kind"/, 'no raw record leaks into the group message');
  });

  test('CONFIRMED denied fixture renders in a "Missed out" section', () => {
    const { message, unrecognized } = waiverReport({ transactions: [REAL_DENIED] }, 1, {
      elements: ELEMENTS,
      display
    });
    assert.match(message, /\*Missed out\*/);
    // entry 1931 is "Mæts back on Semenyo" / Harry Jennings in the real config.
    assert.match(message, /• \*Mæts back on Semenyo\*, Harry Jennings missed Scott for Gravenberch/);
    assert.deepEqual(unrecognized, [], 'result "do" is confirmed — never bucketed');
  });

  test('accepted and denied appear in separate sections of one message', () => {
    const accepted = { ...REAL_CLAIM, event: 1 };
    const { message } = waiverReport({ transactions: [accepted, REAL_DENIED] }, 1, {
      elements: ELEMENTS,
      display
    });
    const acceptedAt = message.indexOf('claimed Semenyo for Sels');
    const headingAt = message.indexOf('*Missed out*');
    const deniedAt = message.indexOf('missed Scott for Gravenberch');
    assert.ok(acceptedAt > -1 && headingAt > -1 && deniedAt > -1, 'all three present');
    assert.ok(acceptedAt < headingAt, 'accepted claims come first');
    assert.ok(headingAt < deniedAt, 'denied claims sit under the heading');
  });

  test('denied-only week still sends, and says no claims went through', () => {
    const { message } = waiverReport({ transactions: [REAL_DENIED] }, 1, {
      elements: ELEMENTS,
      display
    });
    assert.match(message, /No claims went through this week\./);
    assert.doesNotMatch(message, /No waivers processed this week/);
  });

  test('no reason for a denial is invented — the API has no reason field', () => {
    const { message } = waiverReport({ transactions: [REAL_DENIED] }, 1, {
      elements: ELEMENTS,
      display
    });
    assert.doesNotMatch(message, /not available|unavailable|because|reason/i);
  });

  test('NO message when the only records are unrecognized — "no waivers" would be a lie', () => {
    const freeAgent = { ...REAL_CLAIM, id: 79, kind: 'f' };
    const { message, unrecognized } = waiverReport({ transactions: [freeAgent] }, 4, {
      elements: ELEMENTS,
      display
    });
    assert.equal(message, null);
    assert.equal(unrecognized.length, 1);
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
