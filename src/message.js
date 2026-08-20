import {
  finesForWeek,
  fineLedger,
  monthFor,
  monthTable,
  managerOfTheMonth,
  weeklyStats,
  missingWeeks,
  pickleEntryIdForGw
} from './pickle.js';

// WhatsApp markup: *bold*, _italic_, ~strike~
const b = (s) => `*${s}*`;
const i = (s) => `_${s}_`;

/**
 * Season table only: a real aligned table in a monospace block, so
 * Telegram/WhatsApp render it with a fixed-width font. Team name + initials
 * (not the full manager name) — column widths are computed fresh from
 * that week's actual longest name and widest points value, never hardcoded.
 */
function seasonTableBlock(table, managersByEntryId) {
  const rows = table.map((r, idx) => {
    const m = managersByEntryId.get(Number(r.entryId));
    const label = m ? `${m.teamName} (${m.initials})` : `#${r.entryId}`;
    return { rank: idx + 1, label, points: String(r.points) };
  });

  const nameWidth = Math.max(...rows.map((r) => r.label.length));
  const pointsWidth = Math.max(...rows.map((r) => r.points.length));

  const lines = rows.map(
    (r) => `${r.rank}. ${r.label.padEnd(nameWidth)} ${r.points.padStart(pointsWidth)}`
  );

  return ['```', ...lines, '```'].join('\n');
}

export function buildMessage(state, config, gw) {
  // Group-facing display only — "*{teamName}*, {managerName}", sourced from
  // config.managers (hand-maintained), not state.managers (the API scrape
  // ledger.csv still uses). Falls back to a bare entryId if a manager isn't
  // in config.managers yet, e.g. a TODO row not filled in.
  const managersByEntryId = new Map(config.managers.map((m) => [m.entryId, m]));
  const display = (entryId) => {
    const m = managersByEntryId.get(Number(entryId));
    return m ? `${b(m.teamName)}, ${m.managerName}` : `#${entryId}`;
  };

  const stats = weeklyStats(state, gw);
  if (!stats) return `No data recorded for GW${gw}.`;

  const { amount, floatStart, entryFee, lowBalanceWarning } = config.fine;
  const pickleId = pickleEntryIdForGw(config.pickle.history, gw);
  const { picklePoints, fined, drew } = finesForWeek(state, gw, pickleId, amount);
  const ledger = fineLedger(state, config.pickle.history, amount);

  const out = [];
  out.push(`${b(`🥒 PICKLE LEAGUE — GW${gw}`)}`);
  out.push('');

  // --- The pickle line -------------------------------------------------
  out.push(`${b('The Pickle')} (${display(pickleId)}) scored ${b(picklePoints)}`);

  if (fined.length === 0) {
    out.push(i('Nobody finished below the pickle. Clean sheet.'));
  } else {
    out.push('');
    out.push(b(`Fines (£${amount} each)`));
    for (const f of [...fined].sort((a, x) => a.points - x.points)) {
      out.push(`• ${display(f.entryId)} — ${f.points} pts`);
    }
  }

  if (drew.length) {
    out.push(i(`Level with the pickle, no fine: ${drew.map((d) => display(d.entryId)).join(', ')}`));
  }

  // --- Week's stats ----------------------------------------------------
  out.push('');
  out.push(b('This week'));
  out.push(`🏆 Top: ${display(stats.top.entryId)} — ${stats.top.points}`);
  out.push(`💩 Worst: ${display(stats.bottom.entryId)} — ${stats.bottom.points}`);
  out.push(`📊 League average: ${stats.average}`);
  if (stats.bestEver?.gw === gw) {
    out.push(i(`Best score of the season so far 🔥`));
  }

  // --- Month race ------------------------------------------------------
  const month = monthFor(config.motmMonths, gw);
  if (month) {
    const { table, complete } = monthTable(state, month);
    out.push('');
    if (complete) {
      const motm = managerOfTheMonth(state, month);
      const names = motm.winners.map(display).join(' & ');
      out.push(b(`🏅 ${month.label} Manager of the Month`));
      out.push(
        motm.shared
          ? `${names} — ${motm.points} pts each. ${i('Shared, prize splits.')}`
          : `${names} — ${motm.points} pts`
      );
    } else {
      out.push(b(`${month.label} race (GW${month.fromGw}–${month.toGw})`));
      table.forEach((r, idx) => {
        out.push(`${idx + 1}. ${display(r.entryId)} — ${r.points}`);
      });
    }
  }

  // --- Season table ----------------------------------------------------
  out.push('');
  out.push(b('Season table'));
  out.push(seasonTableBlock(stats.table, managersByEntryId));

  // --- Jar total & float balances ---------------------------------------
  out.push('');
  out.push(b('Pickle jar'));
  const balances = stats.table
    .map((r) => ({ entryId: r.entryId, left: floatStart - (ledger.get(r.entryId) ?? 0) }))
    .filter((x) => x.entryId !== pickleId)
    .sort((a, x) => a.left - x.left);

  // Jar starts at the entry pool (entryFee × every manager, pickle included)
  // and grows £1 per fine — recomputed fresh from state.json every run, same
  // as everything else derived. Not to be confused with the £10 float above,
  // which is a separate per-manager figure.
  const jarStart = entryFee * config.expectedManagers;
  const finesCollected = [...ledger.values()].reduce((s, v) => s + v, 0);
  out.push(`Total in the jar: £${jarStart + finesCollected}`);

  const low = balances.filter((x) => x.left <= lowBalanceWarning);
  if (low.length) {
    out.push(i(`Running low: ${low.map((x) => `${display(x.entryId)} (£${x.left})`).join(', ')}`));
  }

  // --- Admin warnings (for Harry, not the group) -----------------------
  const gaps = missingWeeks(state, gw);
  if (gaps.length) {
    out.push('');
    out.push(`⚠️ ${i(`Missing data for GW ${gaps.join(', ')} — run backfill before forwarding.`)}`);
  }

  return out.join('\n');
}
