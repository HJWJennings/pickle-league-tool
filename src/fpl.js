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
 *
 * CONFIRMED (2026-08-24, live): /game returns exactly six fields —
 * `current_event`, `current_event_finished`, `next_event`,
 * `processing_status`, `trades_time_for_approval`, `waivers_processed`.
 * Both names below are real; the `?? null` is now belt-and-braces.
 *
 * ⚠️ `current_event_finished` flips only once bonus points are CONFIRMED, not
 * when the last whistle blows. GW1 2026/27 sat at `false` for hours after all
 * ten fixtures had ended, while every fixture read
 * `finished: false, finished_provisional: true`. That lag is normal and is
 * what index.js's `finished === false` guard deliberately waits out — see the
 * guard's comment in index.js.
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
 * CONFIRMED (2026-08-24, live): `standings[].event_total` and `.total` are
 * real and correct — checked against all nine managers' GW1 scores. Note
 * `event_total` tracks the LIVE score, provisional bonus included, so it is
 * populated well before `current_event_finished` flips.
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
 * VERIFY: the draft history endpoint — still unconfirmed, never yet called
 * against the live API. If /history 404s, fall back to
 * /entry/{entryId}/event/{gw} and read entry_history.points instead.
 */
export async function getEntryHistory(entryId) {
  const data = await get(`/entry/${entryId}/history`);
  return (data.history ?? []).map((h) => ({ event: h.event, points: h.points }));
}

/** Some draft endpoints return a bare array, others wrap it as `.data`. */
function unwrapList(value, name, keys) {
  const list = Array.isArray(value) ? value : value?.data;
  if (!Array.isArray(list)) {
    throw new Error(
      `bootstrap-static returned no usable ${name} array ` +
        `(got ${JSON.stringify(keys)}). Check the shape in src/fpl.js.`
    );
  }
  return list;
}

/**
 * Gameweek list (for deadline maths) and player list (for waiver messages),
 * from one request — both live on bootstrap-static and both are needed on
 * the same tick.
 *
 * CONFIRMED (2026-08-24, live): `events` and `elements` both arrive WRAPPED
 * as `.data`, not as bare arrays — so the unwrap below is load-bearing, not
 * defensive. Top-level keys are `elements, element_types, element_stats,
 * events, fixtures, settings, teams`. Also confirmed:
 * `events[].deadline_time` (GW1 = 2026-08-21T17:30:00Z) and
 * `elements[].web_name` (id 1 = "Raya").
 *
 * A draft `events[]` entry is slim — `average_entry_score`, `deadline_time`,
 * `id`, `name`, `finished`, `highest_scoring_entry`, `trades_time`,
 * `waivers_time` — and notably has NO `finished_provisional` and no
 * `data_checked`. Those live per-FIXTURE on /event/{gw}/fixtures instead
 * (`/fixtures` on its own 404s). Don't reach for them here.
 *
 * The unwrap still throws on any third shape rather than silently yielding an
 * empty list — an empty events list would leave every time-window guard
 * permanently closed and the scheduled messages silently dead.
 */
export async function getBootstrap() {
  const data = await get('/bootstrap-static');
  const keys = Object.keys(data ?? {});
  return {
    events: unwrapList(data?.events, 'events', keys),
    elements: unwrapList(data?.elements, 'elements', keys)
  };
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
