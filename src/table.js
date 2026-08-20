/**
 * Monospace tables for WhatsApp/Telegram.
 *
 * Pure, no I/O. Column widths are always computed from the rows handed in —
 * never hardcoded — so a table stays aligned as names and numbers change,
 * same recompute-not-cache rule as everything else derived in this project.
 *
 * Wrapped in a ``` block so both clients render it fixed-width; without that
 * the padding is meaningless in a proportional font.
 */

/**
 * @param {string[][]} rows - every row must have the same number of cells
 * @param {('left'|'right')[]} align - per column, defaults to left
 */
export function monospaceTable(rows, { align = [] } = {}) {
  if (!rows?.length) return '';

  const columns = rows[0].length;
  const widths = [];
  for (let c = 0; c < columns; c++) {
    widths.push(Math.max(...rows.map((r) => String(r[c] ?? '').length)));
  }

  const lines = rows.map((r) =>
    r
      .map((cell, c) => {
        const s = String(cell ?? '');
        return align[c] === 'right' ? s.padStart(widths[c]) : s.padEnd(widths[c]);
      })
      .join(' ')
      // A left-aligned final column would otherwise trail spaces to the
      // widest row, which some clients render as a ragged right edge.
      .trimEnd()
  );

  return ['```', ...lines, '```'].join('\n');
}
