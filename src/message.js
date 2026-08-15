import {
  finesForWeek,
  fineLedger,
  monthFor,
  monthTable,
  managerOfTheMonth,
  weeklyStats,
  missingWeeks
} from './pickle.js';

// WhatsApp markup: *bold*, _italic_, ~strike~
const b = (s) => `*${s}*`;
const i = (s) => `_${s}_`;

export function buildMessage(state, config, gw) {
  const name = (entryId) => state.managers[String(entryId)]?.teamName ?? `#${entryId}`;
  const who = (entryId) => state.managers[String(entryId)]?.manager ?? `#${entryId}`;

  const stats = weeklyStats(state, gw);
  if (!stats) return `No data recorded for GW${gw}.`;

  const pickleId = config.pickle.entryId;
  const { amount, floatStart, lowBalanceWarning } = config.fine;
  const { picklePoints, fined, drew } = finesForWeek(state, gw, pickleId, amount);
  const ledger = fineLedger(state, pickleId, amount);

  const out = [];
  out.push(`${b(`🥒 PICKLE LEAGUE — GW${gw}`)}`);
  out.push('');

  // --- The pickle line -------------------------------------------------
  out.push(`${b('The Pickle')} (${name(pickleId)}) scored ${b(picklePoints)}`);

  if (fined.length === 0) {
    out.push(i('Nobody finished below the pickle. Clean sheet.'));
  } else {
    out.push('');
    out.push(b(`Fines (£${amount} each)`));
    for (const f of [...fined].sort((a, x) => a.points - x.points)) {
      out.push(`• ${name(f.entryId)} — ${f.points} pts`);
    }
  }

  if (drew.length) {
    out.push(i(`Level with the pickle, no fine: ${drew.map((d) => name(d.entryId)).join(', ')}`));
  }

  // --- Week's stats ----------------------------------------------------
  out.push('');
  out.push(b('This week'));
  out.push(`🏆 Top: ${name(stats.top.entryId)} — ${stats.top.points}`);
  out.push(`💩 Worst: ${name(stats.bottom.entryId)} — ${stats.bottom.points}`);
  out.push(`📊 League average: ${stats.average}`);
  if (stats.bestEver?.gw === gw) {
    out.push(i(`Best score of the season so far 🔥`));
  }

  // --- Month race ------------------------------------------------------
  const month = monthFor(config.months, gw);
  if (month) {
    const { table, complete } = monthTable(state, month);
    out.push('');
    if (complete) {
      const motm = managerOfTheMonth(state, month);
      const names = motm.winners.map(who).join(' & ');
      out.push(b(`🏅 ${month.name} Manager of the Month`));
      out.push(
        motm.shared
          ? `${names} — ${motm.points} pts each. ${i('Shared, prize splits.')}`
          : `${names} — ${motm.points} pts`
      );
    } else {
      out.push(b(`${month.name} race (GW${month.from}–${month.to})`));
      table.forEach((r, idx) => {
        out.push(`${idx + 1}. ${name(r.entryId)} — ${r.points}`);
      });
    }
  }

  // --- Season table ----------------------------------------------------
  out.push('');
  out.push(b('Season table'));
  stats.table.forEach((r, idx) => {
    out.push(`${idx + 1}. ${name(r.entryId)} — ${r.points}`);
  });

  // --- Float balances --------------------------------------------------
  out.push('');
  out.push(b('Pickle jar float'));
  const balances = stats.table
    .map((r) => ({ entryId: r.entryId, left: floatStart - (ledger.get(r.entryId) ?? 0) }))
    .filter((x) => x.entryId !== pickleId)
    .sort((a, x) => a.left - x.left);

  const collected = [...ledger.values()].reduce((s, v) => s + v, 0);
  out.push(`Total in the jar: £${collected}`);

  const low = balances.filter((x) => x.left <= lowBalanceWarning);
  if (low.length) {
    out.push(i(`Running low: ${low.map((x) => `${name(x.entryId)} (£${x.left})`).join(', ')}`));
  }

  // --- Admin warnings (for Harry, not the group) -----------------------
  const gaps = missingWeeks(state, gw);
  if (gaps.length) {
    out.push('');
    out.push(`⚠️ ${i(`Missing data for GW ${gaps.join(', ')} — run backfill before forwarding.`)}`);
  }

  return out.join('\n');
}
