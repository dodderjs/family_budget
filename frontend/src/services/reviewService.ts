import { Transaction, transactionService } from './transactionService';

export interface ConfirmSelectedResult {
  succeeded: number;
  failed: number;
  retrained_samples_total?: number;
  retrained_samples_selected?: number;
}

export interface CategoryPairConflict {
  pairId: string;
  pairCategoryFinal: string;
  attemptedCategory: string;
}

export interface CategoryUpdateWithPairResult {
  updated: Transaction;
  pairUpdated?: Transaction;
  conflict?: CategoryPairConflict;
  pairError?: string;
}

function toErrorMessage(err: any, fallback: string): string {
  return err?.response?.data?.detail || err?.message || fallback;
}

export const reviewService = {
  async updateCategory(transactionId: string, category: string): Promise<Transaction> {
    try {
      const response = await transactionService.updateTransaction(transactionId, category);
      return response.data;
    } catch (err: any) {
      throw new Error(toErrorMessage(err, 'Failed to update transaction'));
    }
  },

  async updateTransferPair(transactionId: string, accountId: string | null): Promise<Transaction> {
    try {
      const response = await transactionService.setTransferPair(transactionId, accountId);
      return response.data;
    } catch (err: any) {
      throw new Error(toErrorMessage(err, 'Failed to update transfer pairing'));
    }
  },

  async updateCategoryWithPair(transaction: Transaction, category: string): Promise<CategoryUpdateWithPairResult> {
    const updated = await reviewService.updateCategory(transaction.id, category);
    const pairId = transaction.transfer_match_id || transaction.duplicate_of_id;
    if (!pairId) {
      return { updated };
    }

    try {
      const pair = (await transactionService.getTransaction(pairId)).data;

      if (!pair.category_final) {
        try {
          const pairUpdated = (await transactionService.updateTransaction(pair.id, category)).data;
          return { updated, pairUpdated };
        } catch (err: any) {
          return {
            updated,
            pairError: toErrorMessage(err, 'Pair category update failed'),
          };
        }
      }

      if (pair.category_final !== category) {
        return {
          updated,
          conflict: {
            pairId,
            pairCategoryFinal: pair.category_final,
            attemptedCategory: category,
          },
        };
      }

      return { updated };
    } catch (err: any) {
      return {
        updated,
        pairError: toErrorMessage(err, 'Failed to load paired transaction'),
      };
    }
  },

  async confirmSelected(transactions: Transaction[]): Promise<ConfirmSelectedResult> {
    const toConfirm = transactions.filter((t) => t.category_final && t.category_predicted);
    if (toConfirm.length === 0) return { succeeded: 0, failed: 0 };

    const results = await Promise.allSettled(
      toConfirm.map((t) => transactionService.updateTransaction(t.id, t.category_final!))
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    let retrainedSamplesTotal: number | undefined;
    let retrainedSamplesSelected: number | undefined;
    if (succeeded > 0) {
      const retrainResponse = await transactionService.retrainModel(succeeded);
      retrainedSamplesTotal = retrainResponse.data.trained_samples_total;
      retrainedSamplesSelected = retrainResponse.data.trained_samples_selected;
    }

    return {
      succeeded,
      failed: toConfirm.length - succeeded,
      retrained_samples_total: retrainedSamplesTotal,
      retrained_samples_selected: retrainedSamplesSelected,
    };
  },
};