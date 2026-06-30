import { describe, expect, it } from 'vitest';
import { csvService } from '../../services/csvService';

describe('csvService.applyMapping', () => {
  it('maps configured fields and parses numeric amount', () => {
    const mapped = csvService.applyMapping(
      [
        {
          bookingDate: '2026-02-03',
          total: '1234.56',
          detail: 'Coffee shop',
          payee: 'Coffee Co',
          curr: 'HUF',
        },
      ],
      {
        dateField: 'bookingDate',
        amountField: 'total',
        descriptionField: 'detail',
        merchantField: 'payee',
        currencyField: 'curr',
      }
    );

    expect(mapped).toEqual([
      {
        date: '2026-02-03',
        amount: 1234.56,
        description: 'Coffee shop',
        merchant: 'Coffee Co',
        currency: 'HUF',
      },
    ]);
  });

  it('uses defaults when optional fields are missing', () => {
    const mapped = csvService.applyMapping(
      [{ date_col: '2026-03-01', amount_col: '-11.2', note: 'Transfer' }],
      {
        dateField: 'date_col',
        amountField: 'amount_col',
        descriptionField: 'note',
      }
    );

    expect(mapped).toEqual([
      {
        date: '2026-03-01',
        amount: -11.2,
        description: 'Transfer',
        merchant: null,
        currency: 'USD',
      },
    ]);
  });
});
