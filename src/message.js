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
import { monospaceTable } from './table.js';

// WhatsApp markup: *bold*, _italic_, ~strike~
const b = (s) => `*${s}*`;
const i = (s) => `_${s}_`;

/** "Team Name (XX)" — the short identifier used inside monospace tables. */
function shortLabel(managersByEntryId, entryId) {
  const m = managersByEntryId.get(Number(entryId));
  return m ? `${m.teamName} (${m.initials})` : `#${entryId}`;
}

/**
 * Short manager identifier for table cells, e.g. "Mæts back on Semenyo (HJ)".
 *
 * Deliberately NOT the "*Team*, Manager Name" of managerDisplay: inside a
 * table there's one row per item rather than one per manager, so the full
 * name blows the width out. Exported so src/draft.js's waiver tables use the
 * identical identifier to the season table.
 */
export function managerShortLabel(config) {
  const managersByEntryId = new Map((config?.managers ?? []).map((m) => [m.entryId, m]));
  return (entryId) => shortLabel(managersByEntryId, entryId);
}

/**
 * Just the manager's name, e.g. "Harry Jennings".
 *
 * Used for the waiver tables, which have one row per transaction and so run
 * much wider than the season table. Every manager name is plain ASCII and at
 * most 16 characters, where "Team Name (XX)" reaches 25 and drags in `æ` and
 * a curly apostrophe — both of which can fall back to a proportional glyph
 * inside a monospace block and break the alignment.
 */
export function managerName(config) {
  const managersByEntryId = new Map((config?.managers ?? []).map((m) => [m.entryId, m]));
  return (entryId) => managersByEntryId.get(Number(entryId))?.managerName ?? `#${entryId}`;
}

/**
 * Season table: a real aligned table in a monospace block, so
 * Telegram/WhatsApp render it with a fixed-width font. Team name + initials
 * (not the full manager name) — column widths are computed fresh from
 * that week's actual longest name and widest points value, never hardcoded.
 */
function seasonTableBlock(table, managersByEntryId) {
  const rows = table.map((r, idx) => [
    `${idx + 1}.`,
    shortLabel(managersByEntryId, r.entryId),
    String(r.points)
  ]);
  return monospaceTable(rows, { align: ['left', 'left', 'right'] });
}

/**
 * Group-facing display only — "*{teamName}*, {managerName}", sourced from
 * config.managers (hand-maintained), not state.managers (the API scrape
 * ledger.csv still uses). Falls back to a bare entryId if a manager isn't
 * in config.managers yet, e.g. a TODO row not filled in.
 *
 * Exported so src/draft.js renders managers identically — one definition of
 * the format, so the waiver message can't drift from the weekly one.
 */
export function managerDisplay(config) {
  const managersByEntryId = new Map((config?.managers ?? []).map((m) => [m.entryId, m]));
  return (entryId) => {
    const m = managersByEntryId.get(Number(entryId));
    return m ? `${b(m.teamName)}, ${m.managerName}` : `#${entryId}`;
  };
}

export function buildMessage(state, config, gw) {
  const managersByEntryId = new Map(config.managers.map((m) => [m.entryId, m]));
  const display = managerDisplay(config);

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
