import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reviewService } from '../../services/reviewService';
import { Transaction, transactionService } from '../../services/transactionService';

vi.mock('../../services/transactionService', () => ({
  transactionService: {
    updateTransaction: vi.fn(),
    getTransaction: vi.fn(),
    setTransferPair: vi.fn(),
    retrainModel: vi.fn(),
  },
}));

const mockedTransactionService = transactionService as unknown as {
  updateTransaction: ReturnType<typeof vi.fn>;
  getTransaction: ReturnType<typeof vi.fn>;
  setTransferPair: ReturnType<typeof vi.fn>;
  retrainModel: ReturnType<typeof vi.fn>;
};

function sampleTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    account_id: 'a1',
    date: '2026-06-27',
    amount: -100,
    currency: 'HUF',
    description: 'Coffee',
    merchant: 'Cafe',
    hash_fingerprint: 'hash',
    category_predicted: 'dining',
    category_confidence: 0.8,
    category_final: null,
    is_transfer: false,
    transfer_match_id: null,
    transfer_match_account_id: null,
    card_hint: null,
    is_duplicate: false,
    duplicate_of_id: null,
    created_at: '2026-06-27T00:00:00Z',
    updated_at: '2026-06-27T00:00:00Z',
    ...overrides,
  };
}

describe('reviewService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates category through transaction service', async () => {
    mockedTransactionService.updateTransaction.mockResolvedValue({
      data: sampleTransaction({ category_final: 'dining' }),
    });

    const result = await reviewService.updateCategory('t1', 'dining');

    expect(mockedTransactionService.updateTransaction).toHaveBeenCalledWith('t1', 'dining');
    expect(result.category_final).toBe('dining');
  });

  it('maps category update backend detail errors to readable messages', async () => {
    mockedTransactionService.updateTransaction.mockRejectedValue({
      response: { data: { detail: 'Validation failed' } },
    });

    await expect(reviewService.updateCategory('t1', 'dining')).rejects.toThrow('Validation failed');
  });

  it('updates transfer pair through transaction service', async () => {
    mockedTransactionService.setTransferPair.mockResolvedValue({
      data: sampleTransaction({ is_transfer: true, transfer_match_account_id: 'a2' }),
    });

    const result = await reviewService.updateTransferPair('t1', 'a2');

    expect(mockedTransactionService.setTransferPair).toHaveBeenCalledWith('t1', 'a2');
    expect(result.transfer_match_account_id).toBe('a2');
  });

  it('updates pair category when pair final category is empty', async () => {
    const source = sampleTransaction({ id: 't1', transfer_match_id: 't2' });
    mockedTransactionService.updateTransaction
      .mockResolvedValueOnce({ data: sampleTransaction({ id: 't1', category_final: 'travel' }) })
      .mockResolvedValueOnce({ data: sampleTransaction({ id: 't2', category_final: 'travel' }) });
    mockedTransactionService.getTransaction.mockResolvedValue({
      data: sampleTransaction({ id: 't2', category_final: null }),
    });

    const result = await reviewService.updateCategoryWithPair(source, 'travel');

    expect(mockedTransactionService.updateTransaction).toHaveBeenNthCalledWith(1, 't1', 'travel');
    expect(mockedTransactionService.getTransaction).toHaveBeenCalledWith('t2');
    expect(mockedTransactionService.updateTransaction).toHaveBeenNthCalledWith(2, 't2', 'travel');
    expect(result.pairUpdated?.id).toBe('t2');
    expect(result.conflict).toBeUndefined();
  });

  it('returns conflict when pair already has a different final category', async () => {
    const source = sampleTransaction({ id: 't1', duplicate_of_id: 't2' });
    mockedTransactionService.updateTransaction.mockResolvedValueOnce({
      data: sampleTransaction({ id: 't1', category_final: 'travel' }),
    });
    mockedTransactionService.getTransaction.mockResolvedValue({
      data: sampleTransaction({ id: 't2', category_final: 'health' }),
    });

    const result = await reviewService.updateCategoryWithPair(source, 'travel');

    expect(mockedTransactionService.updateTransaction).toHaveBeenCalledTimes(1);
    expect(result.conflict).toEqual({
      pairId: 't2',
      pairCategoryFinal: 'health',
      attemptedCategory: 'travel',
    });
  });

  it('keeps primary update successful when pair lookup fails', async () => {
    const source = sampleTransaction({ id: 't1', transfer_match_id: 't2' });
    mockedTransactionService.updateTransaction.mockResolvedValueOnce({
      data: sampleTransaction({ id: 't1', category_final: 'travel' }),
    });
    mockedTransactionService.getTransaction.mockRejectedValue({
      response: { data: { detail: 'Pair not found' } },
    });

    const result = await reviewService.updateCategoryWithPair(source, 'travel');

    expect(result.updated.category_final).toBe('travel');
    expect(result.pairError).toBe('Pair not found');
  });

  it('confirms only rows with final and predicted categories, then retrains on success', async () => {
    mockedTransactionService.updateTransaction
      .mockResolvedValueOnce({ data: sampleTransaction({ id: 't1' }) })
      .mockRejectedValueOnce(new Error('boom'));
    mockedTransactionService.retrainModel.mockResolvedValue({
      data: { status: 'retrained', trained_samples_total: 2914, trained_samples_selected: 1 },
    });

    const result = await reviewService.confirmSelected([
      sampleTransaction({ id: 't1', category_final: 'dining', category_predicted: 'dining' }),
      sampleTransaction({ id: 't2', category_final: 'groceries', category_predicted: 'groceries' }),
      sampleTransaction({ id: 't3', category_final: null, category_predicted: 'salary' }),
    ]);

    expect(mockedTransactionService.updateTransaction).toHaveBeenCalledTimes(2);
    expect(mockedTransactionService.updateTransaction).toHaveBeenNthCalledWith(1, 't1', 'dining');
    expect(mockedTransactionService.updateTransaction).toHaveBeenNthCalledWith(2, 't2', 'groceries');
    expect(mockedTransactionService.retrainModel).toHaveBeenCalledTimes(1);
    expect(mockedTransactionService.retrainModel).toHaveBeenCalledWith(1);
    expect(result).toEqual({
      succeeded: 1,
      failed: 1,
      retrained_samples_total: 2914,
      retrained_samples_selected: 1,
    });
  });

  it('does nothing for empty confirm input', async () => {
    const result = await reviewService.confirmSelected([]);

    expect(result).toEqual({ succeeded: 0, failed: 0 });
    expect(mockedTransactionService.updateTransaction).not.toHaveBeenCalled();
    expect(mockedTransactionService.retrainModel).not.toHaveBeenCalled();
  });
});
