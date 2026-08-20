/**
 * Waivers, free agency and trades.
 *
 * PARTIALLY CONFIRMED. A transaction record looks like:
 *   { added, element_in, element_out, entry, event, id, index, kind,
 *     priority, result }
 * ...of which two combinations are confirmed against real GW1 data:
 * kind 'w' with result 'a' (accepted) and with result 'do' (denied). Every
 * other kind/result value — the presumed 'f' for free agents, anything else
 * — is still unseen, and trades have no confirmed populated shape at all.
 *
 * So this file splits the world in two:
 *   - CONFIRMED shapes are parsed and formatted for real.
 *   - Anything else goes in an "unrecognized" bucket, which the caller
 *     reports once to Harry as a raw-payload alert and then marks handled.
 *     Never formatted, never guessed at, never shown to the group.
 *
 * Why alert-once rather than throw: a throw crashes the run, which fires the
 * workflow's failure alert every single hourly tick until someone fixes it.
 * One alert plus a state guard says the same thing once.
 *
 * Pure: these take already-fetched data and return strings/objects. No I/O.
 */

import { formatUkDeadline } from './deadlines.js';

// WhatsApp markup: *bold*, _italic_
const b = (s) => `*${s}*`;
const i = (s) => `_${s}_`;

/**
 * Confirmed transaction values, all against real GW1 2026/27 data:
 *   kind 'w'    — a waiver claim
 *   result 'a'  — accepted (9 real records, cross-checked against the
 *                 league's own results table)
 *   result 'do' — denied (3 real records, same cross-check). In all three,
 *                 the claim's element_out had already been used as the
 *                 element_out of an EARLIER accepted claim by the same
 *                 manager, so the player was no longer theirs to drop.
 *
 * What the letters "do" abbreviate is not documented anywhere; only the
 * meaning is confirmed, so nothing here expands it.
 */
const KIND_WAIVER = 'w';
const RESULT_ACCEPTED = 'a';
const RESULT_DENIED = 'do';

/**
 * config.endpoints holds the two URLs verbatim as confirmed against the live
 * API, which means each one embeds the league id a second time. Season
 * rollover changes config.leagueId — if these aren't changed with it they'd
 * quietly keep polling LAST season's league and forever report "no waivers".
 * Loud failure over silent wrongness, same as everywhere else.
 */
export function validateEndpoints(endpoints, leagueId) {
  for (const key of ['transactions', 'trades']) {
    const url = endpoints?.[key];
    if (!url) {
      throw new Error(`config.endpoints.${key} is missing — set it in config.json.`);
    }
    if (!url.includes(String(leagueId))) {
      throw new Error(
        `config.endpoints.${key} (${url}) does not contain leagueId ${leagueId}. ` +
          `Entry and league ids change every season — update the endpoint URLs too.`
      );
    }
  }
}

/**
 * Player display name from bootstrap-static's elements array.
 * CONFIRMED: elements[] entries carry { id, web_name, ... } (id 1 = "Raya").
 * Falls back to #id rather than crashing — a missing player degrades one
 * word of one line, same principle as the #entryId manager fallback.
 */
export function playerName(elements, id) {
  const el = (elements ?? []).find((e) => Number(e?.id) === Number(id));
  return el?.web_name ?? `#${id}`;
}

/**
 * Split one gameweek's transactions into accepted claims, denied claims,
 * and everything else.
 *
 * A record is only classified when it matches a confirmed shape exactly:
 * kind 'w', a confirmed result, and the three ids needed to describe it
 * (entry, element_in, element_out) all present. A record missing any of
 * those is a variant nobody has seen, so it goes in `unrecognized` rather
 * than being rendered with a hole in it.
 *
 * Records for other gameweeks are not this week's business and are ignored;
 * a record with no `event` at all is unrecognized, so it can't vanish.
 */
export function classifyTransactions(payload, gw) {
  const all = payload?.transactions ?? [];
  const claims = [];
  const denied = [];
  const unrecognized = [];

  for (const t of all) {
    if (t?.event == null) {
      unrecognized.push(t);
      continue;
    }
    if (Number(t.event) !== Number(gw)) continue; // another gameweek's batch

    const describable =
      t.kind === KIND_WAIVER &&
      t.entry != null &&
      t.element_in != null &&
      t.element_out != null;

    if (describable && t.result === RESULT_ACCEPTED) claims.push(t);
    else if (describable && t.result === RESULT_DENIED) denied.push(t);
    else unrecognized.push(t);
  }

  // CONFIRMED against the real GW1 batch: `index` is the order the waivers
  // were actually processed in, and sorting by it reproduces the league's own
  // results table exactly (12/12 rows). The payload itself arrives grouped by
  // manager instead, so without this the message lists claims in an order
  // that means nothing. `priority` is the round — everyone's first claim,
  // then their second, and so on — which is why an index-ordered list shows a
  // manager's later claim failing on a player their own earlier claim took.
  const byIndex = (a, b) => a.index - b.index;

  return {
    claims: claims.sort(byIndex),
    denied: denied.sort(byIndex),
    unrecognized
  };
}

/**
 * Weekly waiver results, sent ~1h after the waiver deadline.
 *
 * Returns { message, unrecognized }:
 *   - message is the group-facing text, or null when there is nothing
 *     safe to say. Note the null case: if the only records for this
 *     gameweek are unrecognized, we must NOT claim "no waivers processed" —
 *     waivers may well have happened in a shape we can't read. Silence plus
 *     the alert is honest; a confident "nothing happened" would not be.
 *   - unrecognized is the raw records for the caller to alert on once.
 */
export function waiverReport(
  payload,
  gw,
  { elements = [], label = (e) => `#${e}`, deadline = null } = {}
) {
  const { claims, denied, unrecognized } = classifyTransactions(payload, gw);

  /**
   * One line per claim — deliberately NOT merged per manager. Two claims by
   * the same manager are two separate transactions and get two lines.
   *
   * Shape is "II | Out → In": initials, a pipe, then the player leaving, an
   * arrow, and the player arriving. Reads in the direction the move actually
   * happened.
   *
   * Club codes were tried here and removed: "Hall (NEW) → Konsa (AVL)" read
   * well in Telegram but pushed the longest line to 39 characters, which
   * wraps in WhatsApp — and WhatsApp is where the group actually reads it.
   * bootstrap-static's teams[] carries them ({ id, short_name }, joined via
   * elements[].team) if that tradeoff is ever worth revisiting.
   *
   * The separator is a literal pipe rather than a tab because a tab's width
   * is up to the client, and inconsistent width is exactly what broke every
   * earlier attempt at this message. A pipe occupies one character
   * everywhere.
   *
   * No monospace block and no padding, on purpose. The Telegram send sets no
   * parse_mode, so a ``` block would arrive as literal backticks rendered in
   * a proportional font, where padding is decorative at best. Initials are
   * uniformly two characters, so these lines hold their shape unaided in
   * Telegram and WhatsApp alike.
   */
  const lines = (records) =>
    records.map(
      (r) =>
        `${label(r.entry)} | ${playerName(elements, r.element_out)} → ` +
        `${playerName(elements, r.element_in)}`
    );

  // Free agency opens once waivers have run and stays open until the
  // gameweek deadline — worth saying every week, deadline included.
  const freeAgentLine = () => {
    const when = formatUkDeadline(deadline);
    return when
      ? `Free agents are up for grabs until the GW${gw} deadline, ${when}.`
      : 'Free agents are up for grabs until the gameweek deadline.';
  };

  if (claims.length === 0 && denied.length === 0) {
    const message =
      unrecognized.length > 0
        ? null
        : [
            b(`🥒 WAIVERS — GW${gw}`),
            '',
            'No waivers processed this week.',
            i('Nobody put a claim in, or none of them went through.'),
            '',
            freeAgentLine()
          ].join('\n');
    return { message, unrecognized };
  }

  const out = [b(`🥒 WAIVERS — GW${gw}`), ''];

  if (claims.length) {
    out.push(...lines(claims));
  } else {
    out.push(i('No claims went through this week.'));
  }

  // Denied claims are worth showing — missing out is half the fun. The API
  // gives no reason field, so none is invented here.
  if (denied.length) {
    out.push('');
    out.push(b('Missed out'));
    out.push(...lines(denied));
  }

  out.push('');
  out.push(freeAgentLine());

  return { message: out.join('\n'), unrecognized };
}

/**
 * Free-agency results, sent at the gameweek deadline.
 *
 * Free-agency moves are assumed to arrive on the SAME /transactions endpoint
 * as waivers. The presumed 'f' kind is still unconfirmed, so nothing here is
 * formatted: confirmed waiver records — accepted and denied alike — are
 * skipped (the waiver message already reported those), and everything else
 * for this gameweek lands in `unrecognized` for a raw alert.
 *
 * When the remaining kinds are confirmed, this is where the real formatting
 * goes — and the "no free-agency moves" line below becomes trustworthy
 * rather than merely "nothing we recognise".
 */
export function freeAgencyReport(payload, gw) {
  const { unrecognized } = classifyTransactions(payload, gw);

  if (unrecognized.length === 0) {
    return {
      message: [
        b(`🥒 FREE AGENCY — GW${gw}`),
        '',
        'No free-agency moves this week.',
        i('Everyone stood pat.')
      ].join('\n'),
      unrecognized
    };
  }

  // Records exist that we can't read — say nothing to the group, alert Harry.
  return { message: null, unrecognized };
}

/**
 * Trades seen in the payload that aren't in `announced` yet.
 *
 * VERIFY: `id` as the trade identifier is UNCONFIRMED — no populated trades
 * payload has been observed. Any record without a usable id is reported as
 * unrecognized rather than silently skipped (which would drop a real trade)
 * or silently counted (which would claim a trade we can't describe).
 */
export function newTradeIds(payload, announced = []) {
  const trades = payload?.trades ?? [];
  const seen = new Set((announced ?? []).map(String));
  const fresh = [];
  const unidentifiable = [];

  for (const t of trades) {
    if (t?.id == null) {
      unidentifiable.push(t);
      continue;
    }
    if (!seen.has(String(t.id))) fresh.push(t.id);
  }

  return { fresh, unidentifiable };
}

/**
 * Background trade check. Trades have no confirmed populated shape, so a new
 * trade is never formatted — it's reported raw, once, and then marked
 * announced so it doesn't re-alert hourly.
 *
 * Returns { unrecognized, announceIds } — empty/empty on a quiet week, which
 * is the normal case and produces no message at all.
 */
export function tradeReport(payload, announced = []) {
  const trades = payload?.trades ?? [];
  const { fresh, unidentifiable } = newTradeIds(payload, announced);

  if (fresh.length === 0 && unidentifiable.length === 0) {
    return { unrecognized: [], announceIds: [] };
  }

  const freshSet = new Set(fresh.map(String));
  const unrecognized = trades.filter(
    (t) => t?.id == null || freshSet.has(String(t.id))
  );

  // Only ids can be recorded as handled. An id-less record can't be, so it
  // will alert again next tick — correct: it's unsuppressable until the real
  // identifier field is known.
  return { unrecognized, announceIds: fresh };
}

/**
 * The one alert format for every not-yet-confirmed shape. Goes to Harry via
 * the normal Telegram send, never to the group. Includes the raw records so
 * the real shape can be read straight off the phone.
 */
export function buildUnrecognizedAlert(kind, records, { gw = null } = {}) {
  return [
    b(`⚠️ PICKLE BOT — unrecognized ${kind}`),
    '',
    `${records.length} record(s)${gw == null ? '' : ` for GW${gw}`} don't match any ` +
      `shape this tool has confirmed, so nothing about them was sent to the group.`,
    '',
    'Raw records:',
    '```',
    JSON.stringify(records, null, 2),
    '```',
    '',
    i('Alerting once only — this is now marked handled in state.json and will ' +
      'not repeat. Add handling in src/draft.js, then re-run.')
  ].join('\n');
}
