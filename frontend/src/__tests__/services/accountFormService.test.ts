import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accountFormService } from '../../services/accountFormService';
import { Account, transactionService } from '../../services/transactionService';

vi.mock('../../services/transactionService', () => ({
  transactionService: {
    addCard: vi.fn(),
    removeCard: vi.fn(),
  },
}));

const mockedTransactionService = transactionService as unknown as {
  addCard: ReturnType<typeof vi.fn>;
  removeCard: ReturnType<typeof vi.fn>;
};

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'a1',
    name: 'Main account',
    account_number: '****1234',
    type: null,
    created_at: '2026-06-27T00:00:00Z',
    cards: [{ id: 'c1', account_id: 'a1', card_number: '1111', created_at: '2026-06-27T00:00:00Z' }],
    ...overrides,
  };
}

describe('accountFormService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates acceptable account number format', () => {
    expect(accountFormService.validateAccountNumber('****1234')).toEqual({ valid: true, error: '' });
  });

  it('rejects too-short account numbers', () => {
    expect(accountFormService.validateAccountNumber('123')).toEqual({
      valid: false,
      error: 'Account number must be at least 4 characters',
    });
  });

  it('checks form validity from name and account number', () => {
    expect(accountFormService.isAccountFormValid('Personal', '****1234')).toBe(true);
    expect(accountFormService.isAccountFormValid('', '****1234')).toBe(false);
  });

  it('matches accounts by suffix digits against account number or card numbers', () => {
    const accounts = [
      account({ id: 'a1', account_number: '11111111', cards: [] }),
      account({ id: 'a2', account_number: '****5678', cards: [{ id: 'c2', account_id: 'a2', card_number: '9999', created_at: '2026-06-27T00:00:00Z' }] }),
    ];

    expect(accountFormService.findMatchingAccount(accounts, '5678')?.id).toBe('a2');
    expect(accountFormService.findMatchingAccount(accounts, '9999')?.id).toBe('a2');
    expect(accountFormService.findMatchingAccount(accounts, '0000')).toBeUndefined();
  });

  it('syncs cards by adding new and removing stale numbers', async () => {
    mockedTransactionService.addCard.mockResolvedValue({ data: {} });
    mockedTransactionService.removeCard.mockResolvedValue({ data: {} });

    await accountFormService.syncCards(
      'a1',
      [
        { id: 'c1', card_number: '1111' },
        { id: 'c2', card_number: '2222' },
      ],
      ['2222', '3333']
    );

    expect(mockedTransactionService.addCard).toHaveBeenCalledWith('a1', '3333');
    expect(mockedTransactionService.removeCard).toHaveBeenCalledWith('a1', 'c1');
  });
});
