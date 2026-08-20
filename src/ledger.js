import { recordedWeeks, finesForWeek, pickleEntryIdForGw } from './pickle.js';

/**
 * Row-per-manager-per-gameweek ledger for manually checking the fine maths.
 * Pure and derived fresh from state.gameweeks every call — same rule as
 * everything else in src/pickle.js, so it can never drift from state.json.
 *
 * The applicable pickle is resolved per gameweek via pickleEntryIdForGw, the
 * same lookup src/message.js uses — so a pickle change never disagrees
 * between the weekly message and this ledger, and never rewrites already
 * -recorded gameweeks that came before the change.
 */
export function ledgerRows(state, config) {
  const { amount, floatStart } = config.fine;
  const balances = new Map();

  const rows = [];
  for (const gw of recordedWeeks(state)) {
    const week = state.gameweeks[String(gw)];
    const pickleId = pickleEntryIdForGw(config.pickle.history, gw);
    const { picklePoints, fined } = finesForWeek(state, gw, pickleId, amount);
    const finedIds = new Set(fined.map((f) => f.entryId));

    const entries = Object.entries(week)
      .map(([entryId, points]) => ({ entryId: Number(entryId), points }))
      .sort((a, b) => b.points - a.points);

    for (const { entryId, points } of entries) {
      if (!balances.has(entryId)) balances.set(entryId, floatStart);
      if (finedIds.has(entryId)) balances.set(entryId, balances.get(entryId) - amount);

      const m = state.managers[String(entryId)] ?? {};
      rows.push({
        gw,
        entryId,
        teamName: m.teamName ?? '',
        manager: m.manager ?? '',
        points,
        picklePoints,
        fined: finedIds.has(entryId),
        balance: balances.get(entryId)
      });
    }
  }
  return rows;
}

function csvField(value) {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ledgerCsv(state, config) {
  const header = ['Season', 'GW', 'Team', 'Manager', 'Points', 'PicklePoints', 'Fined', 'Balance'];
  const lines = ledgerRows(state, config).map((r) =>
    [
      state.season,
      r.gw,
      r.teamName,
      r.manager,
      r.points,
      r.picklePoints,
      r.fined ? 'Y' : 'N',
      r.balance
    ]
      .map(csvField)
      .join(',')
  );
  return [header.join(','), ...lines].join('\n') + '\n';
}
