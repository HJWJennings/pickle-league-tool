import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { getGameState, getLeague, getEntryHistory } from './src/fpl.js';
import { buildMessage } from './src/message.js';
import { missingWeeks } from './src/pickle.js';
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

  if (!scores.some((s) => s.entryId === config.pickle.entryId)) {
    problems.push(
      `Pickle entryId ${config.pickle.entryId} is not in this league. ` +
        `Entry IDs change every season — has it been updated?`
    );
  }

  if (problems.length) {
    throw new Error('Sanity check failed:\n  - ' + problems.join('\n  - '));
  }
}

async function main() {
  const config = await readJson('./config.json');
  const state = await readJson('./state.json');

  if (!config.leagueId || !config.pickle.entryId) {
    throw new Error('Set leagueId and pickle.entryId in config.json first.');
  }

  const game = await getGameState();
  const gw = game.currentEvent;

  // Off-season: no gameweek to report on.
  if (gw == null) {
    console.log('No current gameweek — off-season. Nothing to do.');
    return;
  }
  console.log(`Current gameweek: ${gw} (finished: ${game.finished})`);

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
