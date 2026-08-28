/**
 * Run with:  node --test
 * Targets src/deadlines.js: pure date maths, no I/O, no clock reads.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  WAIVER_LEAD_MS,
  deadlineTimeForGw,
  gameweekDeadline,
  waiverDeadline,
  withinWindow,
  gameweekInWaiverWindow,
  gameweekInDeadlineWindow
} from '../src/deadlines.js';

// CONFIRMED against the real bootstrap-static: GW1's deadline_time.
const GW1_DEADLINE = '2026-08-21T17:30:00Z';
// 24h earlier.
const GW1_WAIVER = '2026-08-20T17:30:00Z';

// GW2 is invented — only GW1's value is confirmed. It exists here purely to
// prove the lookup picks the right event out of a list of several.
const EVENTS = [
  { id: 1, deadline_time: GW1_DEADLINE },
  { id: 2, deadline_time: '2026-08-28T17:30:00Z' }
];

describe('gameweek deadlines', () => {
  test('reads the confirmed deadline_time for a gameweek', () => {
    assert.equal(deadlineTimeForGw(EVENTS, 1), GW1_DEADLINE);
    assert.equal(deadlineTimeForGw(EVENTS, 2), '2026-08-28T17:30:00Z');
  });

  test('returns null for a gameweek not in the list', () => {
    assert.equal(deadlineTimeForGw(EVENTS, 38), null);
    assert.equal(gameweekDeadline(EVENTS, 38), null);
    assert.equal(waiverDeadline(EVENTS, 38), null);
  });

  test('parses the deadline into a Date', () => {
    assert.equal(gameweekDeadline(EVENTS, 1).toISOString(), '2026-08-21T17:30:00.000Z');
  });

  test('throws on an unparseable deadline_time rather than yielding Invalid Date', () => {
    const broken = [{ id: 1, deadline_time: 'not a date' }];
    assert.throws(() => gameweekDeadline(broken, 1), /Unparseable deadline_time/);
  });
});

describe('waiver deadline (gameweek deadline - 24h)', () => {
  test('GW1: 2026-08-21T17:30:00Z becomes 2026-08-20T17:30:00Z', () => {
    assert.equal(waiverDeadline(EVENTS, 1).toISOString(), '2026-08-20T17:30:00.000Z');
  });

  test('is exactly 24 hours before the gameweek deadline', () => {
    const d = gameweekDeadline(EVENTS, 1).getTime();
    const w = waiverDeadline(EVENTS, 1).getTime();
    assert.equal(d - w, WAIVER_LEAD_MS);
    assert.equal(d - w, 24 * 60 * 60 * 1000);
  });

  test('crossing a month boundary still subtracts a clean 24h', () => {
    const events = [{ id: 5, deadline_time: '2026-09-01T11:00:00Z' }];
    assert.equal(waiverDeadline(events, 5).toISOString(), '2026-08-31T11:00:00.000Z');
  });
});

describe('time windows', () => {
  const target = new Date(GW1_DEADLINE);

  test('open at the target instant, closed once the window elapses', () => {
    assert.equal(withinWindow(new Date('2026-08-21T17:30:00Z'), target), true);
    assert.equal(withinWindow(new Date('2026-08-21T18:30:00Z'), target), true);
    assert.equal(withinWindow(new Date('2026-08-21T19:29:59Z'), target), true);
    assert.equal(withinWindow(new Date('2026-08-21T19:30:00Z'), target), false);
  });

  test('closed before the target', () => {
    assert.equal(withinWindow(new Date('2026-08-21T17:29:59Z'), target), false);
    assert.equal(withinWindow(new Date('2026-08-20T17:30:00Z'), target), false);
  });

  test('afterHours shifts when the window opens', () => {
    const opts = { afterHours: 1, windowHours: 2 };
    assert.equal(withinWindow(new Date('2026-08-21T17:30:00Z'), target, opts), false);
    assert.equal(withinWindow(new Date('2026-08-21T18:30:00Z'), target, opts), true);
    assert.equal(withinWindow(new Date('2026-08-21T20:29:59Z'), target, opts), true);
    assert.equal(withinWindow(new Date('2026-08-21T20:30:00Z'), target, opts), false);
  });

  test('a null target is never in window', () => {
    assert.equal(withinWindow(new Date(GW1_DEADLINE), null), false);
  });
});

describe('which gameweek is in window right now', () => {
  test('waiver window opens ~1h after the waiver deadline and names that gameweek', () => {
    // GW1 waivers process at 2026-08-20T17:30Z; the window runs 18:30 that
    // day until 16:30 the next — an hour before GW1's 17:30 deadline.
    assert.equal(gameweekInWaiverWindow(EVENTS, new Date('2026-08-20T18:30:00Z')), 1);
    assert.equal(gameweekInWaiverWindow(EVENTS, new Date('2026-08-21T16:29:59Z')), 1);
  });

  test('waiver window is closed at the waiver deadline itself and after it lapses', () => {
    assert.equal(gameweekInWaiverWindow(EVENTS, new Date(GW1_WAIVER)), null);
    assert.equal(gameweekInWaiverWindow(EVENTS, new Date('2026-08-21T16:30:00Z')), null);
  });

  test('the waiver window closes before the free-agency window opens', () => {
    // The two must never both claim the same moment. GW1's waiver window
    // ends at 16:30; its free-agency window opens at the 17:30 deadline.
    const gap = new Date('2026-08-21T17:00:00Z');
    assert.equal(gameweekInWaiverWindow(EVENTS, gap), null);
    assert.equal(gameweekInDeadlineWindow(EVENTS, gap), null);
  });

  test('deadline window names the gameweek whose deadline just passed', () => {
    assert.equal(gameweekInDeadlineWindow(EVENTS, new Date(GW1_DEADLINE)), 1);
    assert.equal(gameweekInDeadlineWindow(EVENTS, new Date('2026-08-22T05:29:59Z')), 1);
    assert.equal(gameweekInDeadlineWindow(EVENTS, new Date('2026-08-22T05:30:00Z')), null);
  });

  /**
   * The regression that actually bit us. GitHub's scheduler drifted until
   * consecutive runs were 10h41m apart and the 2h waiver window fell entirely
   * into a gap, so GW2's message was never sent. These assert the windows are
   * wide enough that a run landing ANYWHERE in such a gap still catches them.
   */
  test('a 10h gap between runs still lands in the waiver window', () => {
    // Worst observed real gap, walked across the whole GW2 waiver period.
    const GAP_H = 11; // one hour worse than the worst gap actually seen
    for (let offset = 0; offset < GAP_H; offset++) {
      const hits = [];
      for (let h = offset; h < 48; h += GAP_H) {
        const now = new Date(Date.parse('2026-08-27T00:00:00Z') + h * 60 * 60 * 1000);
        if (gameweekInWaiverWindow(EVENTS, now) === 2) hits.push(now.toISOString());
      }
      assert.ok(
        hits.length > 0,
        `a run every ${GAP_H}h starting at +${offset}h missed GW2's waiver window entirely`
      );
    }
  });

  test('a 10h gap between runs still lands in the free-agency window', () => {
    const GAP_H = 11;
    for (let offset = 0; offset < GAP_H; offset++) {
      const hits = [];
      for (let h = offset; h < 48; h += GAP_H) {
        const now = new Date(Date.parse('2026-08-28T00:00:00Z') + h * 60 * 60 * 1000);
        if (gameweekInDeadlineWindow(EVENTS, now) === 2) hits.push(now.toISOString());
      }
      assert.ok(
        hits.length > 0,
        `a run every ${GAP_H}h starting at +${offset}h missed GW2's free-agency window`
      );
    }
  });

  test('picks GW2, not GW1, inside GW2 windows', () => {
    assert.equal(gameweekInDeadlineWindow(EVENTS, new Date('2026-08-28T18:00:00Z')), 2);
    assert.equal(gameweekInWaiverWindow(EVENTS, new Date('2026-08-27T19:00:00Z')), 2);
  });

  test('a quiet mid-week hour is in no window at all', () => {
    const now = new Date('2026-08-19T09:00:00Z');
    assert.equal(gameweekInWaiverWindow(EVENTS, now), null);
    assert.equal(gameweekInDeadlineWindow(EVENTS, now), null);
  });
});
