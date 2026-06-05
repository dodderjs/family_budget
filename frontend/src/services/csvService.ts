import Papa from 'papaparse';

export interface FormatMapping {
  dateField: string;
  amountField: string;
  descriptionField: string;
  merchantField?: string;
  currencyField?: string;
}

export const csvService = {
  parseFile: (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => resolve(results.data),
        error: (error) => reject(error),
      });
    });
  },

  applyMapping: (rows: any[], mapping: FormatMapping): any[] => {
    return rows.map(row => ({
      date: row[mapping.dateField],
      amount: parseFloat(row[mapping.amountField]),
      description: row[mapping.descriptionField],
      merchant: mapping.merchantField ? row[mapping.merchantField] : null,
      currency: mapping.currencyField ? row[mapping.currencyField] : 'USD',
    }));
  },

  exportToCSV: (data: any[], filename: string) => {
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  },
};
