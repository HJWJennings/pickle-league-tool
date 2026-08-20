/**
 * Preview the weekly message using invented data. Touches no real state,
 * makes no network calls, sends nothing.
 *
 *   node test/preview.js                 # a normal-looking gameweek
 *   node test/preview.js clean-sheet     # pickle scores lowest — nobody fined
 *   node test/preview.js carnage         # pickle scores highest — everyone fined
 *   node test/preview.js month-end       # complete month, so MOTM is announced
 *   node test/preview.js tie             # two managers level for MOTM
 *   node test/preview.js draw            # someone exactly level with the pickle
 *
 * Point of this: read the output as your mates will read it. Wrong-but-valid
 * numbers are the failure mode that tests won't catch.
 */

import { buildMessage } from '../src/message.js';

// ---------------------------------------------------------------------------
// Change this to whoever actually got voted pickle.
const PICKLE = 'RT';
// ---------------------------------------------------------------------------

const MANAGERS = ['DC', 'TP', 'FM', 'HJ', 'RT', 'JJ', 'CR', 'NS', 'RW'];

// Fake entry IDs. Real ones come from the API.
const ID = Object.fromEntries(MANAGERS.map((m, i) => [m, 101 + i]));

const config = {
  leagueId: 999999,
  expectedManagers: MANAGERS.length,
  pickle: { history: [{ fromGw: 1, entryId: ID[PICKLE], label: PICKLE }] },
  fine: { amount: 1, floatStart: 10, lowBalanceWarning: 3 },
  motm: { tieRule: 'split' },
  // Placeholder ranges — replace with your real ones before the season.
  months: [
    { name: 'August', from: 1, to: 3 },
    { name: 'September', from: 4, to: 6 }
  ]
};

/** Deterministic pseudo-random so previews are reproducible. */
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/** Draft squads with no captain tend to land in the 30–65 range. */
function season(gameweeks, seed = 7) {
  const rand = rng(seed);
  const weeks = {};
  for (let gw = 1; gw <= gameweeks; gw++) {
    weeks[String(gw)] = Object.fromEntries(
      MANAGERS.map((m) => [String(ID[m]), 32 + Math.floor(rand() * 34)])
    );
  }
  return weeks;
}

const scenario = process.argv[2] ?? 'normal';

let gameweeks = season(2);
let reportGw = 2;

switch (scenario) {
  case 'clean-sheet':
    // Pickle bottom of the pile, so nobody finishes below them.
    gameweeks['2'][String(ID[PICKLE])] = 18;
    break;

  case 'carnage':
    // Pickle top of the pile, so all eight others pay.
    gameweeks['2'][String(ID[PICKLE])] = 92;
    break;

  case 'draw':
    // DC lands exactly level with the pickle — must NOT be fined.
    gameweeks['2'][String(ID.DC)] = gameweeks['2'][String(ID[PICKLE])];
    break;

  case 'month-end':
    gameweeks = season(3);
    reportGw = 3;
    break;

  case 'tie': {
    // Force DC and TP level across a complete August.
    gameweeks = season(3);
    reportGw = 3;
    for (const gw of ['1', '2', '3']) {
      gameweeks[gw][String(ID.DC)] = 50;
      gameweeks[gw][String(ID.TP)] = 50;
      for (const m of MANAGERS) {
        if (m === 'DC' || m === 'TP') continue;
        gameweeks[gw][String(ID[m])] = 40;
      }
    }
    break;
  }
}

const state = {
  season: 'preview',
  lastReportedGw: null,
  managers: Object.fromEntries(
    MANAGERS.map((m) => [String(ID[m]), { teamName: `${m} FC`, manager: m }])
  ),
  gameweeks
};

console.log(`\nScenario: ${scenario}   |   Pickle: ${PICKLE}   |   Reporting GW${reportGw}`);
console.log('─'.repeat(60));
console.log(buildMessage(state, config, reportGw));
console.log('─'.repeat(60));
console.log('Preview only. No state written, nothing sent.\n');
