const HUF_FORMATTER = new Intl.NumberFormat('hu-HU', {
  style: 'currency',
  currency: 'HUF',
  maximumFractionDigits: 0,
});

export const formatCurrency = (amount: number): string => HUF_FORMATTER.format(amount);
