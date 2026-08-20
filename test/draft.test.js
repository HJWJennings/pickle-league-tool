/**
 * Run with:  node --test
 * Targets src/draft.js: pure, no I/O.
 *
 * The point of most of these is to prove the SCAFFOLDING refuses to guess.
 * The empty case is real and must render; the populated case must throw
 * loudly rather than emit a plausible-looking message built on made-up field
 * names. If someone later fills in the real formatting, the "throws" tests
 * are the ones that should be replaced — deliberately, not by accident.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  validateEndpoints,
  buildWaiverMessage,
  buildFreeAgencyMessage,
  newTradeIds,
  checkTrades
} from '../src/draft.js';

const realConfig = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));

// The only shapes the live API has ever actually returned.
const NO_TRANSACTIONS = { transactions: [] };
const NO_TRADES = { trades: [] };

describe('endpoint config', () => {
  test('the real config.json endpoints carry the configured leagueId', () => {
    assert.doesNotThrow(() => validateEndpoints(realConfig.endpoints, realConfig.leagueId));
  });

  test('throws if an endpoint URL points at a different league than leagueId', () => {
    // The rollover trap: leagueId bumped for the new season, URLs left behind.
    assert.throws(
      () => validateEndpoints(realConfig.endpoints, 999),
      /does not contain leagueId 999/
    );
  });

  test('throws on a missing endpoint', () => {
    assert.throws(() => validateEndpoints({ trades: 'x/812' }, 812), /transactions is missing/);
    assert.throws(() => validateEndpoints({ transactions: 'x/812' }, 812), /trades is missing/);
    assert.throws(() => validateEndpoints(undefined, 812), /transactions is missing/);
  });
});

describe('waiver results message', () => {
  test('empty transactions renders a real "no waivers" message', () => {
    const msg = buildWaiverMessage(NO_TRANSACTIONS, 4);
    assert.match(msg, /\*🥒 WAIVERS — GW4\*/);
    assert.match(msg, /No waivers processed this week\./);
  });

  test('a missing transactions key is treated as empty, not as a crash', () => {
    assert.match(buildWaiverMessage({}, 4), /No waivers processed this week\./);
    assert.match(buildWaiverMessage(undefined, 4), /No waivers processed this week\./);
  });

  test('THROWS on a populated payload rather than formatting a guess', () => {
    // Shape here is invented on purpose — that is the whole point. Whatever
    // the real records look like, the tool must refuse them until confirmed.
    const populated = { transactions: [{ id: 1, whatever: 'unconfirmed shape' }] };
    assert.throws(() => buildWaiverMessage(populated, 4), /will not guess/);
  });

  test('the throw carries the raw payload so the alert shows the real shape', () => {
    const populated = { transactions: [{ id: 7, mystery_field: 'abc' }] };
    assert.throws(() => buildWaiverMessage(populated, 4), /mystery_field/);
  });
});

describe('free agency results message', () => {
  test('empty transactions renders a real "no moves" message', () => {
    const msg = buildFreeAgencyMessage(NO_TRANSACTIONS, 4);
    assert.match(msg, /\*🥒 FREE AGENCY — GW4\*/);
    assert.match(msg, /No free-agency moves this week\./);
  });

  test('a missing transactions key is treated as empty, not as a crash', () => {
    assert.match(buildFreeAgencyMessage({}, 4), /No free-agency moves this week\./);
  });

  test('THROWS on a populated payload rather than guessing the waiver/FA split', () => {
    const populated = { transactions: [{ id: 1, whatever: 'unconfirmed shape' }] };
    assert.throws(() => buildFreeAgencyMessage(populated, 4), /will not guess/);
  });
});

describe('trade detection', () => {
  test('empty trades yields nothing new and no message', () => {
    assert.deepEqual(newTradeIds(NO_TRADES, []), []);
    assert.equal(checkTrades(NO_TRADES, []), null);
  });

  test('a missing trades key is treated as empty', () => {
    assert.equal(checkTrades({}, []), null);
    assert.equal(checkTrades(undefined, []), null);
  });

  test('trades already in announcedTradeIds are not new', () => {
    const payload = { trades: [{ id: 11 }, { id: 12 }] };
    assert.deepEqual(newTradeIds(payload, [11, 12]), []);
    assert.equal(checkTrades(payload, [11, 12]), null, 'fully-announced trades stay silent');
  });

  test('ids compare across string/number so a JSON round-trip cannot re-announce', () => {
    const payload = { trades: [{ id: 11 }] };
    assert.deepEqual(newTradeIds(payload, ['11']), []);
  });

  test('picks out only the unannounced ids', () => {
    const payload = { trades: [{ id: 11 }, { id: 12 }, { id: 13 }] };
    assert.deepEqual(newTradeIds(payload, [11]), [12, 13]);
  });

  test('THROWS on an unannounced trade rather than guessing how to describe it', () => {
    const payload = { trades: [{ id: 99, unconfirmed: 'shape' }] };
    assert.throws(() => checkTrades(payload, []), /will not guess/);
    assert.throws(() => checkTrades(payload, []), /99/);
  });

  test('the throw states that state was NOT updated, so it re-triggers', () => {
    const payload = { trades: [{ id: 99 }] };
    assert.throws(() => checkTrades(payload, []), /announcedTradeIds was NOT updated/);
  });

  test('THROWS on a trade with no id rather than silently skipping it', () => {
    // Silently skipping would mean a real trade never gets announced;
    // silently counting it would mean announcing one we cannot describe.
    const payload = { trades: [{ no_id_here: true }] };
    assert.throws(() => newTradeIds(payload, []), /no 'id' field/);
    assert.throws(() => checkTrades(payload, []), /unconfirmed/);
  });
});
