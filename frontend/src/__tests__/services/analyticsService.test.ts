import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    analyticsService,
    mapBreakdown,
    mapTrends,
} from '../../services/analyticsService';
import { transactionService } from '../../services/transactionService';

vi.mock('../../services/transactionService', () => ({
  transactionService: {
    getAnalyticsSummary: vi.fn(),
    getCategoryBreakdown: vi.fn(),
    getMonthlyTrends: vi.fn(),
  },
}));

const mockedTransactionService = transactionService as unknown as {
  getAnalyticsSummary: ReturnType<typeof vi.fn>;
  getCategoryBreakdown: ReturnType<typeof vi.fn>;
  getMonthlyTrends: ReturnType<typeof vi.fn>;
};

describe('analyticsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps breakdown totals to absolute values', () => {
    expect(
      mapBreakdown({
        groceries: { count: 2, total: -12000 },
        salary: { count: 1, total: 300000 },
      })
    ).toEqual([
      { name: 'groceries', value: 12000 },
      { name: 'salary', value: 300000 },
    ]);
  });

  it('maps monthly trends to chart rows', () => {
    expect(
      mapTrends({
        '2026-01': { income: 100, expenses: 50 },
      })
    ).toEqual([
      { month: '2026-01', income: 100, expenses: 50 },
    ]);
  });

  it('loads dashboard data without previous period when compare is false', async () => {
    mockedTransactionService.getAnalyticsSummary.mockResolvedValue({
      data: {
        total_transactions: 2,
        total_income: 100,
        total_expenses: 80,
        average_transaction: 10,
        categories_used: [],
        total_transferred: 0,
      },
    });
    mockedTransactionService.getCategoryBreakdown.mockResolvedValue({
      data: { groceries: { count: 1, total: -50 } },
    });
    mockedTransactionService.getMonthlyTrends.mockResolvedValue({
      data: { '2026-01': { income: 100, expenses: 80 } },
    });

    const result = await analyticsService.loadDashboardData({
      accountId: 'acc-1',
      range: { from: '2026-01-01', to: '2026-01-31' },
      groupBy: 'category',
      compare: false,
    });

    expect(mockedTransactionService.getAnalyticsSummary).toHaveBeenCalledTimes(1);
    expect(result.previousSummary).toBeNull();
    expect(result.breakdown).toEqual([{ name: 'groceries', value: 50 }]);
    expect(result.trends).toEqual([{ month: '2026-01', income: 100, expenses: 80 }]);
  });

  it('loads previous period summary when compare is true', async () => {
    mockedTransactionService.getAnalyticsSummary
      .mockResolvedValueOnce({
        data: {
          total_transactions: 2,
          total_income: 100,
          total_expenses: 80,
          average_transaction: 10,
          categories_used: [],
          total_transferred: 0,
        },
      })
      .mockResolvedValueOnce({
        data: {
          total_transactions: 1,
          total_income: 50,
          total_expenses: 40,
          average_transaction: 10,
          categories_used: [],
          total_transferred: 0,
        },
      });
    mockedTransactionService.getCategoryBreakdown.mockResolvedValue({ data: {} });
    mockedTransactionService.getMonthlyTrends.mockResolvedValue({ data: {} });

    const result = await analyticsService.loadDashboardData({
      accountId: 'acc-1',
      range: { from: '2026-01-10', to: '2026-01-20' },
      groupBy: 'category',
      compare: true,
    });

    expect(mockedTransactionService.getAnalyticsSummary).toHaveBeenCalledTimes(2);
    expect(result.previousSummary?.total_transactions).toBe(1);
  });
});
