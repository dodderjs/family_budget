import { describe, expect, it } from 'vitest';
import { buildCsv, toCsvCell } from '../../utils/csvExport';

describe('csvExport utilities', () => {
  it('escapes double quotes in a CSV cell', () => {
    expect(toCsvCell('He said "hello"')).toBe('"He said ""hello"""');
  });

  it('builds CSV text with headers and rows', () => {
    const csv = buildCsv(
      ['name', 'amount'],
      [
        ['Coffee', -1200],
        ['Salary', 500000],
      ]
    );

    expect(csv).toBe('name,amount\n"Coffee","-1200"\n"Salary","500000"');
  });
});
