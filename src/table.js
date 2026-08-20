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

  /**
   * Normalise to NFC before measuring. `.length` counts UTF-16 code units, so
   * a decomposed name like "Horníček" (i + combining acute, c + combining
   * caron) measures 10 while it DISPLAYS as 8 — the cell is then padded two
   * short, and every other row in that column overshoots, which is exactly
   * how a table stops lining up. NFC collapses those pairs to one code point
   * each so the count matches what's drawn.
   *
   * Known limit: this does not help for characters that are genuinely wider
   * than one cell (emoji, CJK). No name in this league has any, and guessing
   * at display width in general needs a font, which we don't have.
   */
  const cells = rows.map((r) => r.map((cell) => String(cell ?? '').normalize('NFC')));

  const columns = cells[0].length;
  const widths = [];
  for (let c = 0; c < columns; c++) {
    widths.push(Math.max(...cells.map((r) => (r[c] ?? '').length)));
  }

  const lines = cells.map((r) =>
    r
      .map((s, c) => (align[c] === 'right' ? s.padStart(widths[c]) : s.padEnd(widths[c])))
      .join(' ')
      // A left-aligned final column would otherwise trail spaces to the
      // widest row, which some clients render as a ragged right edge.
      .trimEnd()
  );

  return ['```', ...lines, '```'].join('\n');
}
