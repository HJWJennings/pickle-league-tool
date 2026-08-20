/**
 * Waivers, free agency and trades.
 *
 * ⚠️ SCAFFOLDING. Every function here handles the EMPTY case for real and
 * deliberately THROWS on the populated case. The live API has so far only
 * ever returned `{transactions: []}` and `{trades: []}`, so the shape of a
 * populated record — field names, nested objects, status values — is
 * entirely unconfirmed. Formatting a guess would put a wrong-but-plausible
 * message in front of the group, which is the one failure mode this project
 * exists to avoid. A throw sends a Telegram alert instead; you then read the
 * real payload from the run log and fill in the TODOs below.
 *
 * Pure: these take already-fetched data and return strings. No I/O.
 */

// WhatsApp markup: *bold*, _italic_
const b = (s) => `*${s}*`;
const i = (s) => `_${s}_`;

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
 * Shared guard for the two transaction-backed messages.
 * Throws with the raw payload attached so the failure alert tells you
 * exactly what shape you now need to support.
 */
function refuseToGuess(kind, records) {
  throw new Error(
    `${kind}: the API returned ${records.length} record(s), but this tool has ` +
      `never seen a populated ${kind.toLowerCase()} payload and will not guess at ` +
      `its shape. Nothing was sent.\n` +
      `Fill in the TODO in src/draft.js using the payload below, then re-run.\n` +
      `Raw payload:\n${JSON.stringify(records, null, 2)}`
  );
}

/**
 * Weekly waiver results, sent ~1h after the waiver deadline.
 *
 * @param {object} payload - the /transactions response
 * @param {number} gw - gameweek the waivers ran for
 */
export function buildWaiverMessage(payload, gw) {
  const transactions = payload?.transactions ?? [];

  if (transactions.length === 0) {
    return [
      b(`🥒 WAIVERS — GW${gw}`),
      '',
      'No waivers processed this week.',
      i('Nobody put a claim in, or none of them went through.')
    ].join('\n');
  }

  // TODO(unverified-shape): real waiver formatting goes here.
  // Expected to need, per record: which manager claimed, player in, player
  // out, whether the claim succeeded or was beaten to it, and the waiver
  // priority order. NONE of those field names are confirmed — read them off
  // the payload in the failure alert before writing this.
  return refuseToGuess('Waiver results', transactions);
}

/**
 * Free-agency results, sent at the gameweek deadline.
 *
 * NOTE: free-agency moves are assumed to come from the same /transactions
 * endpoint as waivers. Whether they are distinguishable from waiver records
 * — by a `kind`/`type` field, by timestamp relative to the waiver deadline,
 * or not at all — is UNCONFIRMED, because every response so far has been
 * empty. So this deliberately does not attempt to filter: it treats any
 * non-empty payload as "shape unknown" and throws, exactly like waivers.
 *
 * @param {object} payload - the /transactions response
 * @param {number} gw - gameweek the free-agency window closed for
 */
export function buildFreeAgencyMessage(payload, gw) {
  const transactions = payload?.transactions ?? [];

  if (transactions.length === 0) {
    return [
      b(`🥒 FREE AGENCY — GW${gw}`),
      '',
      'No free-agency moves this week.',
      i('Everyone stood pat.')
    ].join('\n');
  }

  // TODO(unverified-shape): real free-agency formatting goes here, AND the
  // filter that separates free-agency records from waiver records in the
  // same payload. If they share an endpoint with no distinguishing field,
  // decide then whether to split by timestamp against the waiver deadline
  // or merge the two messages into one.
  return refuseToGuess('Free-agency results', transactions);
}

/**
 * Trades seen in the payload that aren't in `announced` yet.
 *
 * VERIFY: `id` as the trade identifier is UNCONFIRMED — no populated trades
 * payload has been observed. Any record without a usable id throws rather
 * than being silently skipped (which would re-announce it forever) or
 * silently counted (which would announce a trade we can't describe).
 *
 * @param {object} payload - the /trades response
 * @param {Array<string|number>} announced - state.announcedTradeIds
 */
export function newTradeIds(payload, announced = []) {
  const trades = payload?.trades ?? [];
  if (trades.length === 0) return [];

  const seen = new Set((announced ?? []).map(String));
  const fresh = [];

  for (const t of trades) {
    if (t?.id == null) {
      throw new Error(
        `Trade record has no 'id' field, so it cannot be tracked against ` +
          `state.announcedTradeIds. The trades payload shape is unconfirmed — ` +
          `check the real field name and update newTradeIds in src/draft.js.\n` +
          `Raw record:\n${JSON.stringify(t, null, 2)}`
      );
    }
    if (!seen.has(String(t.id))) fresh.push(t.id);
  }

  return fresh;
}

/**
 * Background trade check. Returns null when there's nothing new (the normal
 * case — no message is sent for trades on a quiet week), and otherwise
 * throws, because a populated trade record can't yet be described safely.
 */
export function checkTrades(payload, announced = []) {
  const fresh = newTradeIds(payload, announced);
  if (fresh.length === 0) return null;

  // TODO(unverified-shape): real trade announcement goes here.
  // Expected to need: the two managers involved, players moving each way,
  // and whether the trade is proposed / accepted / vetoed. Unconfirmed —
  // read them off the payload in the failure alert first.
  throw new Error(
    `Trade check: ${fresh.length} unannounced trade(s) (ids: ${fresh.join(', ')}), ` +
      `but this tool has never seen a populated trades payload and will not guess ` +
      `at its shape. Nothing was sent and state.announcedTradeIds was NOT updated, ` +
      `so this will re-trigger until the TODO in src/draft.js is filled in.\n` +
      `Raw payload:\n${JSON.stringify(payload?.trades ?? [], null, 2)}`
  );
}
