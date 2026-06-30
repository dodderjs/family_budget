import { describe, expect, it } from 'vitest';
import { accountIdParam, previousPeriod, resolveDateRange } from '../../utils/dateRange';

describe('dateRange utilities', () => {
  it('returns undefined account filter for empty selection', () => {
    expect(accountIdParam([])).toBeUndefined();
  });

  it('joins account ids for API parameter', () => {
    expect(accountIdParam(['a', 'b', 'c'])).toBe('a,b,c');
  });

  it('returns null range for all-time preset', () => {
    expect(resolveDateRange('all')).toEqual({ from: null, to: null });
  });

  it('returns custom range verbatim', () => {
    expect(resolveDateRange('custom', '2026-01-01', '2026-01-31')).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    });
  });

  it('computes previous period with same duration', () => {
    expect(previousPeriod({ from: '2026-01-10', to: '2026-01-20' })).toEqual({
      from: '2025-12-30',
      to: '2026-01-09',
    });
  });
});
