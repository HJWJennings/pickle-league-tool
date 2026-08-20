import { readFile, writeFile, appendFile } from 'node:fs/promises';
import {
  getGameState,
  getLeague,
  getEntryHistory,
  getBootstrap,
  getTransactions,
  getTrades
} from './src/fpl.js';
import { buildMessage, managerInitials } from './src/message.js';
import {
  missingWeeks,
  validatePickleHistory,
  pickleEntryIdForGw,
  validateMotmMonths
} from './src/pickle.js';
import {
  validateEndpoints,
  waiverReport,
  freeAgencyReport,
  tradeReport,
  buildUnrecognizedAlert
} from './src/draft.js';
import {
  gameweekInWaiverWindow,
  gameweekInDeadlineWindow,
  gameweekDeadline
} from './src/deadlines.js';
import { ledgerCsv } from './src/ledger.js';

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force'); // record + send even if unsettled or already reported
const BACKFILL = args.has('--backfill'); // fill gameweeks the cron missed
const DRY = args.has('--dry-run'); // print only: no state write, no send

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

/** Keeps ledger.csv committed in the same run as state.json, always derived fresh. */
async function writeState(state, config) {
  await writeFile('./state.json', JSON.stringify(state, null, 2) + '\n');
  await writeFile('./ledger.csv', ledgerCsv(state, config));
}

/**
 * Fails loudly on the failure modes that would otherwise pass silently.
 * A crash emails you; a wrong-but-plausible message doesn't. So we crash.
 */
function sanityCheck(league, config, gw) {
  const problems = [];
  const scores = league.scores;
  const pickleEntryId = pickleEntryIdForGw(config.pickle.history, gw);

  if (config.expectedManagers && scores.length !== config.expectedManagers) {
    problems.push(
      `Expected ${config.expectedManagers} managers, API returned ${scores.length}. ` +
        `Someone left the league, or config.expectedManagers is stale.`
    );
  }

  const notNumbers = scores.filter(
    (s) => typeof s.eventPoints !== 'number' || Number.isNaN(s.eventPoints)
  );
  if (notNumbers.length) {
    problems.push(
      `Non-numeric points for: ${notNumbers.map((s) => s.teamName ?? s.entryId).join(', ')}. ` +
        `The API shape has almost certainly changed — check the field names in src/fpl.js.`
    );
  }

  if (scores.length && scores.every((s) => s.eventPoints === 0)) {
    problems.push(
      `Every manager scored 0 in GW${gw}. That is a field-name problem, not a bad week.`
    );
  }

  if (!scores.some((s) => s.entryId === pickleEntryId)) {
    problems.push(
      `Pickle entryId ${pickleEntryId} (resolved for GW${gw}) is not in this league. ` +
        `Entry IDs change every season — has config.pickle.history been updated?`
    );
  }

  if (problems.length) {
    throw new Error('Sanity check failed:\n  - ' + problems.join('\n  - '));
  }
}

async function main() {
  const config = await readJson('./config.json');
  const state = await readJson('./state.json');

  if (!config.leagueId) {
    throw new Error('Set leagueId in config.json first.');
  }
  validatePickleHistory(config.pickle.history);
  validateMotmMonths(config.motmMonths);
  validateEndpoints(config.endpoints, config.leagueId);

  const game = await getGameState();
  const gw = game.currentEvent;

  // Three independent jobs on one hourly cron. The gameweek report keeps its
  // own guards and is untouched by the others; the draft tasks run whether or
  // not it decided to send, so its early exits can't suppress them.
  //
  // No current gameweek means only that there's nothing to REPORT ON. It must
  // not skip the draft tasks: a season's very first waiver deadline lands 24h
  // before GW1's deadline, while current_event is still null, so returning
  // here would make the opening waiver message of every season unsendable.
  // runDraftTasks doesn't read current_event at all — it resolves its own
  // gameweek from the deadline list, which is unambiguous year-round.
  if (gw == null) {
    console.log('No current gameweek — skipping the gameweek report.');
  } else {
    console.log(`Current gameweek: ${gw} (finished: ${game.finished})`);
    await runGameweekReport(config, state, game, gw);
  }

  await runDraftTasks(config, state);
}

/**
 * The weekly scores summary. Logic unchanged from when this was the whole
 * script — same finished/lastReportedGw guards, same order, same writes. It
 * just returns instead of ending the process, so the draft tasks can follow.
 */
async function runGameweekReport(config, state, game, gw) {
  if (game.finished === false && !FORCE) {
    console.log('Gameweek not settled yet — bailing. Re-run later or pass --force.');
    return;
  }

  const league = await getLeague(config.leagueId);
  sanityCheck(league, config, gw);

  // Refresh the directory so renamed teams stay current.
  for (const m of league.managers) {
    state.managers[String(m.entryId)] = { teamName: m.teamName, manager: m.manager };
  }

  // Record raw points. Overwriting is safe — everything else is derived.
  state.gameweeks[String(gw)] = Object.fromEntries(
    league.scores.map((s) => [String(s.entryId), s.eventPoints])
  );

  if (BACKFILL) {
    const gaps = missingWeeks(state, gw);
    for (const missing of gaps) state.gameweeks[String(missing)] ??= {};
    for (const m of league.managers) {
      const history = await getEntryHistory(m.entryId);
      for (const h of history) {
        if (!gaps.includes(h.event)) continue;
        state.gameweeks[String(h.event)][String(m.entryId)] = h.points;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    console.log(`Backfilled: ${gaps.join(', ') || 'nothing missing'}`);
  }

  /**
   * The cron fires 52 Tuesdays a year; the football calendar does not.
   * During international breaks current_event stays put, so without this
   * guard you'd resend the same summary. State still gets saved (scores are
   * sometimes corrected after the fact) — we just don't send again.
   */
  const alreadySent = state.lastReportedGw != null && gw <= state.lastReportedGw;

  if (alreadySent && !FORCE) {
    console.log(`GW${gw} already reported (last sent: GW${state.lastReportedGw}).`);
    console.log('International break or nothing new — saving state, not sending.');
    if (!DRY) await writeState(state, config);
    return;
  }

  const message = buildMessage(state, config, gw);
  console.log('\n' + message + '\n');

  if (DRY) {
    console.log('Dry run — nothing written or sent.');
    return;
  }

  state.lastReportedGw = gw;
  await writeState(state, config);
  await sendToTelegram(message);
  await writeStepSummary(message);
}

/**
 * Waivers, free agency and trades. Confirmed waiver shapes (kind 'w' with
 * result 'a' or 'do') are formatted for real; anything else is alerted on
 * once and marked handled rather than thrown. See src/draft.js.
 *
 * The cron fires hourly; these time-window guards are what stop the two
 * scheduled messages attempting a send on all 24 ticks. The
 * lastWaiverGw/lastFreeAgencyGw guards then stop a second tick inside the
 * same window sending twice — same pattern as lastReportedGw.
 */
async function runDraftTasks(config, state) {
  const now = new Date();
  const { events, elements, teams } = await getBootstrap();
  const label = managerInitials(config);

  /**
   * Unrecognized records are reported ONCE and then marked handled, keyed by
   * the record's own id. Not a boolean or a gameweek number: a later payload
   * with a genuinely different unknown shape must still get through, and
   * suppressing that would be exactly the silent wrongness we're avoiding.
   * Same shape and reasoning as announcedTradeIds.
   */
  const alerted = new Set((state.unrecognizedTransactionsAlerted ?? []).map(String));
  const unseen = (records) => records.filter((r) => r?.id == null || !alerted.has(String(r.id)));

  const sendAlert = async (kind, records, gw) => {
    const alert = buildUnrecognizedAlert(kind, records, { gw });
    console.log('\n' + alert + '\n');
    if (DRY) {
      console.log('Dry run — alert not sent, nothing marked handled.');
      return;
    }
    for (const r of records) {
      if (r?.id != null) alerted.add(String(r.id));
    }
    state.unrecognizedTransactionsAlerted = [...alerted];
    await writeState(state, config);
    await sendToTelegram(alert);
    await writeStepSummary(alert);
  };

  const sendMessage = async (message, mark) => {
    console.log('\n' + message + '\n');
    if (DRY) {
      console.log('Dry run — message not written or sent.');
      return;
    }
    mark();
    await writeState(state, config);
    await sendToTelegram(message);
    await writeStepSummary(message);
  };

  // --- Waiver results: ~1h after the waiver deadline (deadline - 24h) ---
  const waiverGw = gameweekInWaiverWindow(events, now);
  if (waiverGw == null) {
    console.log('Not in a waiver-results window — skipping.');
  } else if (state.lastWaiverGw != null && waiverGw <= state.lastWaiverGw && !FORCE) {
    console.log(`GW${waiverGw} waivers already reported — skipping.`);
  } else {
    console.log(`In GW${waiverGw} waiver-results window.`);
    const payload = await getTransactions(config.endpoints.transactions);
    const { message, unrecognized } = waiverReport(payload, waiverGw, {
      elements,
      teams,
      label,
      deadline: gameweekDeadline(events, waiverGw)
    });

    if (message) {
      await sendMessage(message, () => {
        state.lastWaiverGw = waiverGw;
      });
    } else {
      // Records existed but none were readable — saying "no waivers" would
      // be a guess, so the group hears nothing and Harry gets the alert.
      console.log(`GW${waiverGw}: no recognizable waiver claims — nothing sent to the group.`);
    }

    const fresh = unseen(unrecognized);
    if (fresh.length) await sendAlert('transaction records', fresh, waiverGw);
  }

  // --- Free-agency results: at the gameweek deadline ---
  const faGw = gameweekInDeadlineWindow(events, now);
  if (faGw == null) {
    console.log('Not in a free-agency-results window — skipping.');
  } else if (state.lastFreeAgencyGw != null && faGw <= state.lastFreeAgencyGw && !FORCE) {
    console.log(`GW${faGw} free agency already reported — skipping.`);
  } else {
    console.log(`In GW${faGw} free-agency-results window.`);
    const payload = await getTransactions(config.endpoints.transactions);
    const { message, unrecognized } = freeAgencyReport(payload, faGw);

    if (message) {
      await sendMessage(message, () => {
        state.lastFreeAgencyGw = faGw;
      });
    } else {
      console.log(`GW${faGw}: unreadable transaction records — nothing sent to the group.`);
    }

    const fresh = unseen(unrecognized);
    if (fresh.length) await sendAlert('transaction records', fresh, faGw);
  }

  // --- Trades: background check, no schedule and no message when quiet ---
  // Trades complete whenever the two managers agree, not at any gameweek
  // checkpoint, so this runs on every tick with no time window at all.
  const trades = await getTrades(config.endpoints.trades);
  const { unrecognized, announceIds } = tradeReport(trades, state.announcedTradeIds);

  if (unrecognized.length === 0) {
    console.log('No unannounced trades.');
  } else {
    // No confirmed trade shape at all yet, so a new trade is never formatted
    // for the group — it's reported raw to Harry, once.
    const alert = buildUnrecognizedAlert('trade records', unrecognized);
    console.log('\n' + alert + '\n');
    if (DRY) {
      console.log('Dry run — trade alert not sent, nothing marked announced.');
    } else {
      state.announcedTradeIds = [...(state.announcedTradeIds ?? []), ...announceIds];
      await writeState(state, config);
      await sendToTelegram(alert);
      await writeStepSummary(alert);
    }
  }
}

/**
 * Delivered to you, not the group — you forward it.
 * No parse_mode is set on purpose: Telegram then shows the *asterisks*
 * literally, and pasting into WhatsApp renders them as bold.
 */
async function sendToTelegram(text) {
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('No Telegram secrets set — message is in the run summary only.');
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
  if (!res.ok) throw new Error(`Telegram send failed: ${res.status} ${await res.text()}`);
}

/** Puts the message on the Actions run page, copy-pasteable from a phone. */
async function writeStepSummary(text) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  await appendFile(path, '```\n' + text + '\n```\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
