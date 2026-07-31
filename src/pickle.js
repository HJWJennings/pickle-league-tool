/**
 * Everything here is DERIVED from state.gameweeks on every run.
 * Nothing is accumulated in place. That means a re-run, a backfill, or a
 * corrected score can never double-fine anyone — the numbers are always
 * recomputed from the raw points.
 */

/** Gameweek numbers we have data for, in order. */
export function recordedWeeks(state) {
  return Object.keys(state.gameweeks)
    .map(Number)
    .sort((a, b) => a - b);
}

/** Gaps in the record, e.g. a week the cron failed. */
export function missingWeeks(state, upTo) {
  const have = new Set(recordedWeeks(state));
  const gaps = [];
  for (let gw = 1; gw <= upTo; gw++) if (!have.has(gw)) gaps.push(gw);
  return gaps;
}

/**
 * Fines for a single gameweek.
 * Rule: you pay only if you score STRICTLY LOWER than the pickle.
 * Drawing with the pickle is not a loss, so no fine.
 */
export function finesForWeek(state, gw, pickleEntryId, amount) {
  const week = state.gameweeks[String(gw)];
  if (!week) return { picklePoints: null, fined: [], drew: [] };

  const picklePoints = week[String(pickleEntryId)];
  if (picklePoints === undefined) return { picklePoints: null, fined: [], drew: [] };

  const fined = [];
  const drew = [];

  for (const [entryId, points] of Object.entries(week)) {
    if (Number(entryId) === Number(pickleEntryId)) continue;
    if (points < picklePoints) fined.push({ entryId: Number(entryId), points, amount });
    else if (points === picklePoints) drew.push({ entryId: Number(entryId), points });
  }

  return { picklePoints, fined, drew };
}

/** Running fine total per manager across the whole season so far. */
export function fineLedger(state, pickleEntryId, amount) {
  const totals = new Map();
  for (const gw of recordedWeeks(state)) {
    const { fined } = finesForWeek(state, gw, pickleEntryId, amount);
    for (const f of fined) {
      totals.set(f.entryId, (totals.get(f.entryId) ?? 0) + f.amount);
    }
  }
  return totals;
}

/** Which configured month contains this gameweek. */
export function monthFor(months, gw) {
  return months.find((m) => gw >= m.from && gw <= m.to) ?? null;
}

/**
 * Monthly totals for one month's gameweek range.
 * Double gameweeks are deliberately NOT normalised — planning for them is
 * part of the game.
 */
export function monthTable(state, month) {
  const totals = new Map();
  const weeksCounted = [];

  for (let gw = month.from; gw <= month.to; gw++) {
    const week = state.gameweeks[String(gw)];
    if (!week) continue;
    weeksCounted.push(gw);
    for (const [entryId, points] of Object.entries(week)) {
      totals.set(Number(entryId), (totals.get(Number(entryId)) ?? 0) + points);
    }
  }

  const table = [...totals.entries()]
    .map(([entryId, points]) => ({ entryId, points }))
    .sort((a, b) => b.points - a.points);

  const complete = weeksCounted.length === month.to - month.from + 1;
  return { month, table, weeksCounted, complete };
}

/** Manager of the month. Ties are shared, and the prize splits between them. */
export function managerOfTheMonth(state, month) {
  const { table, complete, weeksCounted } = monthTable(state, month);
  if (!table.length) return null;

  const top = table[0].points;
  const winners = table.filter((r) => r.points === top);

  return {
    month: month.name,
    points: top,
    winners: winners.map((w) => w.entryId),
    shared: winners.length > 1,
    complete,
    weeksCounted
  };
}

/** The interesting bits for the weekly message. */
export function weeklyStats(state, gw) {
  const week = state.gameweeks[String(gw)];
  if (!week) return null;

  const rows = Object.entries(week)
    .map(([entryId, points]) => ({ entryId: Number(entryId), points }))
    .sort((a, b) => b.points - a.points);

  const seasonTotals = new Map();
  for (const g of recordedWeeks(state)) {
    if (g > gw) continue;
    for (const [entryId, points] of Object.entries(state.gameweeks[String(g)])) {
      seasonTotals.set(Number(entryId), (seasonTotals.get(Number(entryId)) ?? 0) + points);
    }
  }

  const table = [...seasonTotals.entries()]
    .map(([entryId, points]) => ({ entryId, points }))
    .sort((a, b) => b.points - a.points);

  // Best single gameweek by anyone, all season
  let bestEver = null;
  for (const g of recordedWeeks(state)) {
    for (const [entryId, points] of Object.entries(state.gameweeks[String(g)])) {
      if (!bestEver || points > bestEver.points) {
        bestEver = { entryId: Number(entryId), points, gw: g };
      }
    }
  }

  return {
    gw,
    top: rows[0],
    bottom: rows[rows.length - 1],
    average: Math.round(rows.reduce((s, r) => s + r.points, 0) / rows.length),
    rows,
    table,
    bestEver
  };
}
