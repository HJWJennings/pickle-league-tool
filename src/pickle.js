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
export function fineLedger(state, history, amount) {
  const totals = new Map();
  for (const gw of recordedWeeks(state)) {
    const pickleEntryId = pickleEntryIdForGw(history, gw);
    const { fined } = finesForWeek(state, gw, pickleEntryId, amount);
    for (const f of fined) {
      totals.set(f.entryId, (totals.get(f.entryId) ?? 0) + f.amount);
    }
  }
  return totals;
}

/**
 * Validates config.pickle.history's shape: non-empty, and each entry's
 * fromGw strictly greater than the previous. That single check catches both
 * "unsorted" and "duplicate fromGw" — either would make the lookup below
 * ambiguous, so both are hard errors rather than a silent best-guess.
 */
export function validatePickleHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    throw new Error('config.pickle.history is empty — set at least one { fromGw, entryId }.');
  }
  for (let i = 1; i < history.length; i++) {
    if (history[i].fromGw <= history[i - 1].fromGw) {
      throw new Error(
        `config.pickle.history must be sorted by strictly increasing fromGw. ` +
          `Entry ${i} (fromGw ${history[i].fromGw}) does not come after entry ${i - 1} ` +
          `(fromGw ${history[i - 1].fromGw}) — fix the ordering, or remove the duplicate.`
      );
    }
  }
}

/**
 * Which pickle applied to a given gameweek: the history entry with the
 * highest fromGw that is <= gw. Pure, no side effects, recomputed fresh on
 * every call — the result must never be cached across gameweeks, since two
 * different gameweeks can legitimately resolve to two different pickles.
 */
export function pickleEntryIdForGw(history, gw) {
  validatePickleHistory(history);
  let applicable = null;
  for (const h of history) {
    // history is validated ascending by fromGw, so the last match wins.
    if (h.fromGw <= gw) applicable = h;
  }
  if (!applicable) {
    throw new Error(
      `No pickle history entry applies to GW${gw} — earliest entry starts at GW${history[0].fromGw}.`
    );
  }
  return applicable.entryId;
}

/**
 * Validates config.motmMonths: sorted by fromGw, contiguous (no gaps or
 * overlaps), and covering exactly GW1-38 — the fixed length of a Premier
 * League season. Thrown, not warned: a gap or overlap would silently drop a
 * gameweek from every month's total, or double-count it, which is exactly
 * the wrong-but-plausible result this project refuses to produce.
 */
export function validateMotmMonths(months) {
  if (!Array.isArray(months) || months.length === 0) {
    throw new Error('config.motmMonths is empty — set at least one { label, fromGw, toGw }.');
  }

  let expectedFrom = 1;
  for (const m of months) {
    if (m.toGw < m.fromGw) {
      throw new Error(`config.motmMonths: ${m.label} has toGw (${m.toGw}) before fromGw (${m.fromGw}).`);
    }
    if (m.fromGw !== expectedFrom) {
      throw new Error(
        `config.motmMonths has a gap or overlap: expected ${m.label} to start at GW${expectedFrom}, ` +
          `but it starts at GW${m.fromGw}.`
      );
    }
    expectedFrom = m.toGw + 1;
  }

  if (expectedFrom - 1 !== 38) {
    throw new Error(
      `config.motmMonths must cover exactly GW1-38; it currently covers GW1-${expectedFrom - 1}.`
    );
  }
}

/** Which configured month contains this gameweek. */
export function monthFor(months, gw) {
  return months.find((m) => gw >= m.fromGw && gw <= m.toGw) ?? null;
}

/**
 * Monthly totals for one month's gameweek range.
 * Double gameweeks are deliberately NOT normalised — planning for them is
 * part of the game.
 */
export function monthTable(state, month) {
  const totals = new Map();
  const weeksCounted = [];

  for (let gw = month.fromGw; gw <= month.toGw; gw++) {
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

  const complete = weeksCounted.length === month.toGw - month.fromGw + 1;
  return { month, table, weeksCounted, complete };
}

/** Manager of the month. Ties are shared, and the prize splits between them. */
export function managerOfTheMonth(state, month) {
  const { table, complete, weeksCounted } = monthTable(state, month);
  if (!table.length) return null;

  const top = table[0].points;
  const winners = table.filter((r) => r.points === top);

  return {
    month: month.label,
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
