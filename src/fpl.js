const BASE = 'https://draft.premierleague.com/api';

async function getUrl(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'pickle-league/1.0' }
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json();
}

async function get(path) {
  return getUrl(`${BASE}${path}`);
}

/**
 * Which gameweek are we in, and are its scores settled?
 * VERIFY: field names on /game. `current_event` is reliable;
 * `current_event_finished` may be named differently — hit the endpoint in a
 * browser once and adjust. The `?? null` keeps this from crashing either way.
 */
export async function getGameState() {
  const game = await get('/game');
  return {
    currentEvent: game.current_event,
    finished: game.current_event_finished ?? null,
    raw: game
  };
}

/**
 * One request gives us the whole league: who's in it and what they scored
 * this gameweek.
 *
 * GOTCHA: there are two different IDs in this payload.
 *   league_entries[].id       -> the *league entry* id, used by standings[]
 *   league_entries[].entry_id -> the *FPL entry* id, used by /entry/ endpoints
 * Mixing them up is the single most likely reason this breaks. We key
 * everything on entry_id and translate once, here.
 */
export async function getLeague(leagueId) {
  const data = await get(`/league/${leagueId}/details`);

  const managers = data.league_entries.map((e) => ({
    leagueEntryId: e.id,
    entryId: e.entry_id,
    teamName: e.entry_name,
    manager: [e.player_first_name, e.player_last_name].filter(Boolean).join(' '),
    shortName: e.short_name
  }));

  const byLeagueEntry = new Map(managers.map((m) => [m.leagueEntryId, m]));

  const scores = data.standings
    .map((s) => {
      const m = byLeagueEntry.get(s.league_entry);
      if (!m) return null;
      return {
        entryId: m.entryId,
        teamName: m.teamName,
        manager: m.manager,
        eventPoints: s.event_total,
        seasonPoints: s.total,
        rank: s.rank
      };
    })
    .filter(Boolean);

  return { leagueName: data.league?.name ?? 'Pickle League', managers, scores };
}

/**
 * Backfill path, only needed if a weekly run was missed.
 * VERIFY: the draft history endpoint. If /history 404s, fall back to
 * /entry/{entryId}/event/{gw} and read entry_history.points instead.
 */
export async function getEntryHistory(entryId) {
  const data = await get(`/entry/${entryId}/history`);
  return (data.history ?? []).map((h) => ({ event: h.event, points: h.points }));
}

/**
 * Gameweek list, for deadline maths.
 *
 * `deadline_time` on each event is CONFIRMED (GW1 = 2026-08-21T17:30:00Z).
 * VERIFY: the container. Some FPL endpoints return `events` as a bare array,
 * others wrap it as `events.data`. Both are unwrapped here; anything else
 * throws rather than silently yielding an empty list, which would leave every
 * time-window guard permanently closed and the new messages silently dead.
 */
export async function getEvents() {
  const data = await get('/bootstrap-static');
  const events = Array.isArray(data.events) ? data.events : data.events?.data;
  if (!Array.isArray(events)) {
    throw new Error(
      `bootstrap-static returned no usable events array ` +
        `(got ${JSON.stringify(Object.keys(data ?? {}))}). Check the shape in src/fpl.js.`
    );
  }
  return events;
}

/**
 * Waiver + free-agency transactions.
 * ⚠️ Only ever observed as `{transactions: []}`. The populated shape is
 * unconfirmed — src/draft.js throws rather than formatting a guess.
 */
export async function getTransactions(url) {
  return getUrl(url);
}

/**
 * Trades.
 * ⚠️ Only ever observed as `{trades: []}`. Same caveat as above.
 */
export async function getTrades(url) {
  return getUrl(url);
}
