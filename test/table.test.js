/**
 * Run with:  node --test
 * Targets src/table.js: pure, no I/O.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { monospaceTable } from '../src/table.js';

/** Column start offsets on one rendered line. */
const offsets = (line, cells) => {
  let at = 0;
  return cells.map((c) => {
    at = line.indexOf(c, at);
    return at;
  });
};

describe('monospace table', () => {
  test('pads every column to the widest cell', () => {
    const out = monospaceTable([
      ['Manager', 'In'],
      ['Theo Pennefather', 'Madjo'],
      ['David Cole', 'Amad']
    ]);
    const lines = out.split('\n').slice(1, -1);
    assert.equal(lines[1].indexOf('Madjo'), 17, '"Theo Pennefather" is 16, so In starts at 17');
    assert.equal(lines[2].indexOf('Amad'), 17, 'shorter name is padded to the same offset');
  });

  test('right-aligned columns pad on the left', () => {
    const out = monospaceTable([['a', '5'], ['b', '100']], { align: ['left', 'right'] });
    const lines = out.split('\n').slice(1, -1);
    assert.equal(lines[0], 'a   5');
    assert.equal(lines[1], 'b 100');
  });

  test('no trailing whitespace on a left-aligned final column', () => {
    const out = monospaceTable([['a', 'long'], ['b', 'x']]);
    for (const line of out.split('\n')) assert.equal(line, line.trimEnd());
  });

  test('wraps in a single monospace block', () => {
    const out = monospaceTable([['a']]);
    assert.equal(out.split('\n')[0], '```');
    assert.equal(out.split('\n').at(-1), '```');
  });

  test('empty input yields nothing rather than an empty block', () => {
    assert.equal(monospaceTable([]), '');
    assert.equal(monospaceTable(undefined), '');
  });

  test('REGRESSION: a decomposed (NFD) name does not break alignment', () => {
    // "Horníček" written with combining marks: it DISPLAYS as 8 characters but
    // .length counts 10, so without normalisation the column is padded two
    // short and every other row overshoots — the exact way a table stops
    // lining up. Player names come from an API we don't control, so the
    // encoding is not ours to assume.
    const nfd = 'Horníček';
    const nfc = 'Horníček'.normalize('NFC');
    assert.equal(nfd.length, 10, 'precondition: the decomposed form over-counts');
    assert.equal(nfd.normalize('NFC').length, 8, 'precondition: NFC collapses it');

    const out = monospaceTable([
      ['Theo Pennefather', nfd, 'Martinez'],
      ['David Cole', 'Amad', 'Neto']
    ]);
    const lines = out.split('\n').slice(1, -1);

    // Both rows must put the third column at the same offset.
    const a = offsets(lines[0], [nfd.normalize('NFC'), 'Martinez']);
    const b = offsets(lines[1], ['Amad', 'Neto']);
    assert.equal(a[0], b[0], 'second column starts at one offset on both rows');
    assert.equal(a[1], b[1], 'third column starts at one offset on both rows');
  });

  test('output is normalised, so what is measured is what is sent', () => {
    const out = monospaceTable([['Horníček']]);
    assert.ok(out.includes('Horníček'.normalize('NFC')));
  });
});
