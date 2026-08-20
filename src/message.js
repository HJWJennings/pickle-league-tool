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
 * Just the manager's name, e.g. "Harry Jennings".
 *
 * Used for every ranked line in the weekly message, and available to the
 * waiver lines. Every manager name is plain ASCII and at most 16 characters,
 * where a team name reaches 25 and drags in `æ` and a curly apostrophe —
 * both of which can fall back to a proportional glyph and pull a line out of
 * shape.
 */
export function managerName(config) {
  const managersByEntryId = new Map((config?.managers ?? []).map((m) => [m.entryId, m]));
  return (entryId) => managersByEntryId.get(Number(entryId))?.managerName ?? `#${entryId}`;
}

/**
 * Just the initials, e.g. "HJ".
 *
 * Used by the waiver lines, which need to survive being read in Telegram.
 * The Telegram send sets no parse_mode on purpose, so a ``` block arrives as
 * literal backticks and the text renders in Telegram's proportional font —
 * any column padding is meaningless there and only takes effect once the
 * message is pasted into WhatsApp. Every manager's initials are exactly two
 * characters, so a line built from them needs no padding to line up in the
 * first place, in either client.
 */
export function managerInitials(config) {
  const managersByEntryId = new Map((config?.managers ?? []).map((m) => [m.entryId, m]));
  return (entryId) => managersByEntryId.get(Number(entryId))?.initials ?? `#${entryId}`;
}

export function buildMessage(state, config, gw) {
  const stats = weeklyStats(state, gw);
  if (!stats) return `No data recorded for GW${gw}.`;

  const initials = managerInitials(config);
  const name = managerName(config);
  /**
   * Every ranked line is "points - manager", points first.
   *
   * Points-first is what lets these lines read straight without any padding:
   * the numbers are the same width as each other far more often than the
   * names are, so the eye finds the ranking without a monospace block — which
   * would not survive Telegram anyway (no parse_mode; see the waiver lines in
   * src/draft.js for the full reasoning).
   */
  const ranked = (rows) => rows.map((r, idx) => `${idx + 1}. ${b(r.points)} - ${name(r.entryId)}`);

  const { amount, floatStart, entryFee, lowBalanceWarning } = config.fine;
  const pickleId = pickleEntryIdForGw(config.pickle.history, gw);
  const { picklePoints, fined, drew } = finesForWeek(state, gw, pickleId, amount);
  const ledger = fineLedger(state, config.pickle.history, amount);

  const out = [];
  out.push(`${b(`🥒 PICKLE LEAGUE — GW${gw} RESULTS`)}`);
  out.push('');

  // --- The pickle line -------------------------------------------------
  out.push(`${b(`The Pickle (${initials(pickleId)})`)} scored ${b(picklePoints)}`);

  if (fined.length === 0) {
    out.push('');
    out.push(i('Nobody finished below the pickle. Clean sheet.'));
  } else {
    out.push('');
    out.push(b(`Fines (£${amount} each)`));
    for (const f of [...fined].sort((a, x) => a.points - x.points)) {
      out.push(`• ${initials(f.entryId)} — ${f.points} pts`);
    }
  }

  if (drew.length) {
    out.push(i(`Level with the pickle, no fine: ${drew.map((d) => initials(d.entryId)).join(', ')}`));
  }

  // --- Week's stats ----------------------------------------------------
  out.push('');
  out.push(b('This week'));
  out.push(`🏆 Top: ${b(stats.top.points)} - ${name(stats.top.entryId)}`);
  out.push(`💩 Worst: ${b(stats.bottom.points)} - ${name(stats.bottom.entryId)}`);
  out.push(`📊 League average: ${b(stats.average)}`);
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
      const names = motm.winners.map(name).join(' & ');
      out.push(b(`🏅 ${month.label} MOTM`));
      out.push(
        motm.shared
          ? `${names} - ${b(`${motm.points} pts each`)} ${i('Shared, prize splits.')}`
          : `${names} - ${b(`${motm.points} pts`)}`
      );
    } else {
      out.push(b(`${month.label} race (GW${month.fromGw}–${month.toGw})`));
      out.push('');
      out.push(...ranked(table));
    }
  }

  // --- Season table ----------------------------------------------------
  out.push('');
  out.push(b('Season table'));
  out.push('');
  out.push(...ranked(stats.table));

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
  out.push(`Pot: £${jarStart + finesCollected}`);

  const low = balances.filter((x) => x.left <= lowBalanceWarning);
  if (low.length) {
    out.push(i(`Running low: ${low.map((x) => `${initials(x.entryId)} (£${x.left})`).join(', ')}`));
  }

  // --- Admin warnings (for Harry, not the group) -----------------------
  const gaps = missingWeeks(state, gw);
  if (gaps.length) {
    out.push('');
    out.push(`⚠️ ${i(`Missing data for GW ${gaps.join(', ')} — run backfill before forwarding.`)}`);
  }

  return out.join('\n');
}
