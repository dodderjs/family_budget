import { ResolvedDateRange } from '../utils/dateRange';
import { AnalyticsDashboardData, analyticsService } from './analyticsService';
import { RecurringCharge, TransferAnalytics, transactionService } from './transactionService';

export interface CoverageSummary {
  covered: number;
  gap: number;
  missing: number;
  dismissed: number;
}

export interface UploadAccountActivity {
  accountId: string;
  accountName: string;
  accountType: string | null;
  firstDate: string | null;
  lastDate: string | null;
  transactionsInCoverage: number;
  coverageSummary: CoverageSummary;
}

export interface DashboardHomeData {
  analytics: AnalyticsDashboardData;
  transfers: TransferAnalytics;
  /** Always a trailing 12 months (the backend anchors the window on the newest
   * transaction), deliberately not the page's selected period - a subscription
   * needs several months of history before it can be recognised at all. */
  recurring: RecurringCharge[];
  uploadAccounts: UploadAccountActivity[];
  totals: {
    trackedAccounts: number;
    activeAccounts: number;
    uploadedTransactions: number;
    coverageMonths: CoverageSummary;
  };
}

export const dashboardService = {
  async loadHomeData(params: {
    accountId?: string | null;
    range: ResolvedDateRange;
    categoryKeys?: string;
  }): Promise<DashboardHomeData> {
    // The account list and every account's coverage arrive together from the
    // batched endpoint. This used to be a /accounts call followed by one
    // /accounts/{id}/coverage per account, serialized behind it.
    const [analytics, coverageResponse, transfersResponse, recurringResponse] = await Promise.all([
      analyticsService.loadDashboardData({
        accountId: params.accountId,
        range: params.range,
        groupBy: 'category',
        compare: true,
        categoryKeys: params.categoryKeys,
        // Feeds the top-merchants list. Cheap now the breakdown is a SQL
        // aggregate rather than a full-table scan in Python.
        includeMerchants: true,
      }),
      transactionService.listAccountsCoverage(),
      transactionService.getTransferAnalytics(params.accountId, params.range.from, params.range.to),
      transactionService.getRecurringCharges(params.accountId),
    ]);

    const uploadAccounts = coverageResponse.data.map((row) => ({
      accountId: row.account_id,
      accountName: row.account_name,
      accountType: row.account_type,
      firstDate: row.first_date,
      lastDate: row.last_date,
      transactionsInCoverage: row.transaction_count,
      coverageSummary: {
        covered: row.covered,
        gap: row.gap,
        missing: row.missing,
        dismissed: row.dismissed,
      },
    }));

    const totals = uploadAccounts.reduce(
      (acc, item) => {
        acc.trackedAccounts += 1;
        if (item.transactionsInCoverage > 0) acc.activeAccounts += 1;
        acc.uploadedTransactions += item.transactionsInCoverage;
        acc.coverageMonths.covered += item.coverageSummary.covered;
        acc.coverageMonths.gap += item.coverageSummary.gap;
        acc.coverageMonths.missing += item.coverageSummary.missing;
        acc.coverageMonths.dismissed += item.coverageSummary.dismissed;
        return acc;
      },
      {
        trackedAccounts: 0,
        activeAccounts: 0,
        uploadedTransactions: 0,
        coverageMonths: { covered: 0, gap: 0, missing: 0, dismissed: 0 },
      }
    );

    return {
      analytics,
      transfers: transfersResponse.data,
      recurring: recurringResponse.data,
      uploadAccounts,
      totals,
    };
  },
};
